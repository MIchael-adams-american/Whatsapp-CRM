/**
 * Import / connect modal (used from the Leads toolbar, Dashboard and Settings).
 * Three routes in: paste a Google Sheet link, upload a CSV, or load demo data.
 */

import { el, clear } from '../lib/dom.js';
import { openModal, notify, withBusy } from '../ui/kit.js';
import { parseSheetUrl, parseCSV, rowsToObjects } from '../lib/utils.js';
import { updateSheetConfig, store } from '../lib/store.js';
import { autoMapColumns, rowsToLeads, analyseSheet } from '../services/mapping.js';
import { importLeadsFromRows, loadDemoData } from '../services/actions.js';
import { importSheet } from '../services/sheets.js';
import { downloadTextFile } from '../lib/utils.js';
import { demoSheetCsv, DEMO_HEADERS } from '../data/demo-data.js';
import { buildDemoLeads } from '../data/demo-data.js';
import { icon } from '../ui/components.js';
import { EVENTS, emit } from '../lib/bus.js';

export function openImportSheetModal({ onDone = null } = {}) {
  const urlInput = el('input', {
    type: 'url',
    placeholder: 'https://docs.google.com/spreadsheets/d/…',
    autocomplete: 'off',
    'aria-label': 'Google Sheet URL',
  });
  urlInput.value = store.get('sheet')?.url || '';

  const headerRowInput = el('input', { type: 'number', min: '1', value: String(store.get('sheet')?.headerRow || 1), 'aria-label': 'Header row number' });
  const status = el('div', { class: 'field__hint' });

  const tabs = el('div', { class: 'chips' }, [
    el('span', { class: 'chip is-active', text: 'Google Sheet link' }),
    el('span', { class: 'chip', text: 'CSV upload' }),
    el('span', { class: 'chip', text: 'Demo data' }),
  ]);

  const fileInput = el('input', {
    type: 'file',
    accept: '.csv,text/csv',
    style: { display: 'none' },
    onchange: async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const rows = parseCSV(text);
        const { headers, records } = rowsToObjects(rows);
        if (!headers.length) throw new Error('That CSV file appears to be empty.');
        const analysis = analyseSheet(headers, records);
        const mapping = analysis.mapping;
        if (!mapping.name) throw new Error('Could not find a "Name" column in that CSV file.');
        const leads = rowsToLeads(records, mapping, { headerOffset: 0 });
        const merge = importLeadsFromRows(leads, 'sheet');
        notify.success(`Imported ${leads.length} leads from ${file.name} (${merge.added.length} new).`);
        modal.close();
        onDone?.();
      } catch (error) {
        notify.error(error.message || 'Could not read that CSV file.');
      }
    },
  });

  const body = el('div', {}, [
    tabs,
    el('p', { class: 'small muted', style: { margin: '12px 0' } }, [
      el('span', { text: 'Paste the full Google Sheets link. The sheet must be shared as ' }),
      el('strong', { text: '"Anyone with the link – Viewer"' }),
      el('span', { text: ', or use the Apps Script method in Settings for a private sheet.' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Google Sheet URL' }),
      urlInput,
      status,
    ]),
    el('div', { class: 'field', style: { maxWidth: '160px' } }, [
      el('label', { text: 'Header row number' }),
      headerRowInput,
      el('span', { class: 'field__hint', text: 'Usually row 1. Increase it if your sheet has titles above the headers.' }),
    ]),
    el('div', { class: 'row', style: { marginTop: '6px' } }, [
      el('button', {
        class: 'btn btn--sm btn--outline',
        type: 'button',
        text: 'Upload a CSV file instead',
        onclick: () => fileInput.click(),
      }, [icon('i-upload'), el('span', { text: 'Upload CSV file' })]),
      el('button', {
        class: 'btn btn--sm btn--ghost',
        type: 'button',
        text: 'Download example sheet (CSV)',
        onclick: () => {
          downloadTextFile('my-crm-example-leads.csv', demoSheetCsv(), 'text/csv;charset=utf-8');
          notify.info('Example CSV downloaded — open it in Google Sheets to see the recommended columns.');
        },
      }),
    ]),
    el('div', { class: 'banner banner--info', style: { margin: '14px 0 0' } }, [
      icon('i-sheet'),
      el('div', {}, [
        el('strong', { text: 'Recommended columns: ' }),
        el('span', { text: DEMO_HEADERS.join(' · ') }),
        el('p', { class: 'small', style: { marginTop: '6px' }, text: 'Any column order works — My CRM maps the columns for you and remembers your corrections.' }),
      ]),
    ]),
    fileInput,
  ]);

  const modal = openModal({
    title: 'Connect or import a sheet',
    subtitle: 'Bring your leads into My CRM without changing your spreadsheet.',
    body,
    footer: [
      {
        label: 'Load demo data',
        class: 'btn btn--ghost',
        close: false,
        onClick: () => {
          loadDemoData();
          modal.close();
          onDone?.();
        },
      },
      { label: 'Cancel', class: 'btn btn--outline', onClick: () => {} },
      {
        label: 'Connect & import',
        class: 'btn btn--primary',
        close: false,
        onClick: async (event, api) => {
          const url = urlInput.value.trim();
          if (!url) {
            status.textContent = 'Paste your Google Sheet link first, or upload a CSV file.';
            status.style.color = 'var(--red)';
            return;
          }
          const parsed = parseSheetUrl(url);
          if (!parsed.valid) {
            status.textContent = 'That does not look like a Google Sheet link. Copy the URL from your browser.';
            status.style.color = 'var(--red)';
            return;
          }

          await withBusy(event.currentTarget, 'Importing…', async () => {
            updateSheetConfig({
              url,
              spreadsheetId: parsed.id,
              gid: parsed.gid,
              headerRow: Number(headerRowInput.value) || 1,
            });
            try {
              const result = await importSheet(store.get('sheet'), {
                savedMapping: store.get('sheet').columns,
                headerRow: Number(headerRowInput.value) || 1,
              });
              const merge = importLeadsFromRows(result.leads, 'sheet');
              updateSheetConfig({
                columns: result.mapping,
                lastSyncAt: new Date().toISOString(),
                lastSyncStatus: 'ok',
                lastSyncMessage: `${result.leads.length} leads imported`,
                lastSyncCount: result.leads.length,
              });
              notify.success(`Imported ${result.leads.length} leads (${merge.added.length} new).`, { title: 'Sheet connected' });
              api.close();
              emit(EVENTS.SYNC_DONE, { added: merge.added.length, total: result.leads.length });
              onDone?.();
            } catch (error) {
              updateSheetConfig({ lastSyncStatus: 'error', lastSyncMessage: error.friendly || error.message });
              status.textContent = error.friendly || error.message || 'Could not read that sheet.';
              status.style.color = 'var(--red)';
              notify.error(error.friendly || 'Could not read that sheet.', {
                title: 'Import failed',
                action: { label: 'Open sheet setup guide', onClick: () => window.open('./docs/GOOGLE_SHEETS_SETUP.md', '_blank') },
              });
            }
          });
        },
      },
    ],
  });
  return modal;
}
