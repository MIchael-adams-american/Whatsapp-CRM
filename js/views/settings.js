/**
 * Settings (sections 13, 14, 15, 20).
 * Four tabs: Google Sheet · AI & Gemini · Data & privacy · Help.
 */

import { el, clear } from '../lib/dom.js';
import { notify, confirmDialog, withBusy, openModal } from '../ui/kit.js';
import { icon, badge, statTile } from '../ui/components.js';
import { formatDate, friendlyTimestamp } from '../lib/date.js';
import { parseSheetUrl, downloadTextFile, objectsToCSV, formatBytes } from '../lib/utils.js';
import { CRM_FIELDS, MESSAGE_STYLES } from '../config.js';
import { MAPPABLE_FIELDS } from '../config.js';
import {
  store, updateSettings, updateSheetConfig, purgeAllData, persistSheet, clearAiCache,
  DEFAULT_SETTINGS, DEFAULT_SHEET, storage,
} from '../lib/store.js';
import { importSheet, previewSheet } from '../services/sheets.js';
import { testConnection, aiStatus } from '../services/ai.js';
import {
  currentLeads, syncFromSheet, loadDemoData, clearAllLeads, importLeadsFromRows,
} from '../services/actions.js';
import { EVENTS, emit } from '../lib/bus.js';
import { openImportSheetModal } from './import-sheet.js';
import { demoSheetCsv, DEMO_HEADERS } from '../data/demo-data.js';

const TABS = [
  { id: 'sheet', label: 'Google Sheet' },
  { id: 'ai', label: 'AI & Gemini' },
  { id: 'privacy', label: 'Data & privacy' },
  { id: 'help', label: 'Help' },
];

let activeTab = 'sheet';
let detectedHeaders = [];

export function renderSettings(root, { query = {} } = {}) {
  if (query.tab && TABS.some((t) => t.id === query.tab)) activeTab = query.tab;

  const wrap = el('div');
  wrap.appendChild(el('section', { class: 'section' }, [
    el('h1', { text: 'Settings', style: { fontSize: '1.3rem' } }),
    el('p', { class: 'muted', text: 'Connect your data, configure the AI assistant and control what My CRM stores.' }),
  ]));

  const layout = el('div', { class: 'settings-layout' });
  const nav = el('nav', { class: 'settings-nav', 'aria-label': 'Settings sections' }, TABS.map((tab) => el('button', {
    class: tab.id === activeTab ? 'is-active' : '',
    type: 'button',
    text: tab.label,
    onclick: () => { activeTab = tab.id; window.location.hash = `#/settings?tab=${tab.id}`; emit(EVENTS.VIEW_REFRESH); },
  })));

  const content = el('div');
  if (activeTab === 'sheet') content.appendChild(sheetTab());
  if (activeTab === 'ai') content.appendChild(aiTab());
  if (activeTab === 'privacy') content.appendChild(privacyTab());
  if (activeTab === 'help') content.appendChild(helpTab());

  layout.appendChild(nav);
  layout.appendChild(content);
  wrap.appendChild(layout);

  clear(root);
  root.appendChild(wrap);
}

/* ------------------------------------------------------------ sheet tab -- */

function sheetTab() {
  const sheet = store.get('sheet');
  const wrap = el('div', { class: 'stack' });
  detectedHeaders = sheet.headers || [];

  /* status ------------------------------------------------------------- */
  const statusPanel = el('section', { class: 'panel' });
  statusPanel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-sheet'), el('span', { text: 'Google Sheet connection' })]),
    el('span', { class: 'spacer' }),
    sheet.spreadsheetId || sheet.appsScriptUrl ? badge('Connected', 'green', 'badge--dot') : badge('Not connected', 'outline'),
  ]));

  const statusBody = el('div', { class: 'panel__body' });
  if (sheet.spreadsheetId || sheet.appsScriptUrl) {
    statusBody.appendChild(el('dl', { class: 'def-list' }, [
      el('dt', { text: 'Sheet' }),
      el('dd', {}, [
        sheet.spreadsheetId
          ? el('a', { href: `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit`, target: '_blank', rel: 'noopener', text: sheet.url || sheet.spreadsheetId })
          : el('span', { text: sheet.appsScriptUrl }),
      ]),
      el('dt', { text: 'Last synced' }),
      el('dd', { text: sheet.lastSyncAt ? `${friendlyTimestamp(sheet.lastSyncAt)} — ${sheet.lastSyncMessage || ''}` : 'Never synced yet' }),
      el('dt', { text: 'Leads from sheet' }),
      el('dd', { text: String(store.get('source') === 'sheet' ? currentLeads().length : 0) }),
      el('dt', { text: 'Header row' }),
      el('dd', { text: String(sheet.headerRow || 1) }),
    ]));
  } else {
    statusBody.appendChild(el('p', { class: 'muted', text: 'No sheet connected yet. Paste your Google Sheet link below (or use the Apps Script option for a private sheet).' }));
  }

  statusBody.appendChild(el('div', { class: 'btn-group', style: { marginTop: '12px' } }, [
    el('button', {
      class: 'btn btn--primary btn--sm',
      type: 'button',
      onclick: async (event) => {
        await withBusy(event.currentTarget, 'Syncing…', async () => {
          const result = await syncFromSheet();
          if (result.ok) emit(EVENTS.VIEW_REFRESH);
        });
      },
    }, [icon('i-sync'), el('span', { text: 'Sync Now' })]),
    el('button', {
      class: 'btn btn--outline btn--sm',
      type: 'button',
      text: 'Import / connect wizard',
      onclick: () => openImportSheetModal({ onDone: () => emit(EVENTS.VIEW_REFRESH) }),
    }),
    (sheet.spreadsheetId || sheet.appsScriptUrl) ? el('button', {
      class: 'btn btn--outline btn--sm',
      type: 'button',
      text: 'Preview sheet & columns',
      onclick: () => openPreviewModal(),
    }) : null,
    (sheet.spreadsheetId || sheet.appsScriptUrl) ? el('button', {
      class: 'btn btn--danger btn--sm',
      type: 'button',
      text: 'Disconnect sheet',
      onclick: async () => {
        const confirmed = await confirmDialog({
          title: 'Disconnect the Google Sheet?',
          message: 'My CRM stops reading the sheet. The leads already on this device stay until you delete them.',
          confirmLabel: 'Disconnect',
          danger: true,
        });
        if (!confirmed) return;
        updateSheetConfig({ ...DEFAULT_SHEET });
        notify.info('Google Sheet disconnected.');
        emit(EVENTS.VIEW_REFRESH);
      },
    }) : null,
  ]));
  statusPanel.appendChild(statusBody);
  wrap.appendChild(statusPanel);

  /* connect ------------------------------------------------------------ */
  const urlInput = el('input', { type: 'url', value: sheet.url || '', placeholder: 'https://docs.google.com/spreadsheets/d/…' });
  const headerRowInput = el('input', { type: 'number', min: '1', value: String(sheet.headerRow || 1) });
  const sheetNameInput = el('input', { type: 'text', value: sheet.sheetName || '', placeholder: 'e.g. Leads (leave blank for the first tab)' });
  const rangeInput = el('input', { type: 'text', value: sheet.range || '', placeholder: 'e.g. A1:O500 (optional)' });
  const appsScriptInput = el('input', { type: 'url', value: sheet.appsScriptUrl || '', placeholder: 'https://script.google.com/macros/s/…/exec' });
  const apiKeyInput = el('input', { type: 'password', value: sheet.apiKey || '', placeholder: 'Optional — public sheets only' });

  const connectPanel = el('section', { class: 'panel' });
  connectPanel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-link'), el('span', { text: 'Connect a Google Sheet' })]),
  ]));
  connectPanel.appendChild(el('div', { class: 'panel__body' }, [
    el('p', { class: 'small muted', text: 'Two ways to connect. Start with the link method — it works for any sheet shared as "Anyone with the link – Viewer".' }),
    el('div', { class: 'field' }, [el('label', { text: 'Google Sheet URL' }), urlInput]),
    el('div', { class: 'form-grid form-grid--3' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Header row number' }), headerRowInput]),
      el('div', { class: 'field' }, [el('label', { text: 'Tab / sheet name (optional)' }), sheetNameInput]),
      el('div', { class: 'field' }, [el('label', { text: 'Range (optional)' }), rangeInput]),
    ]),
    el('div', { class: 'btn-group' }, [
      el('button', {
        class: 'btn btn--primary btn--sm',
        type: 'button',
        onclick: async (event) => {
          const url = urlInput.value.trim();
          const parsed = parseSheetUrl(url);
          if (!parsed.valid) {
            notify.warn('That does not look like a Google Sheet link.');
            return;
          }
          await withBusy(event.currentTarget, 'Connecting…', async () => {
            updateSheetConfig({
              url,
              spreadsheetId: parsed.id,
              gid: parsed.gid,
              headerRow: Number(headerRowInput.value) || 1,
              sheetName: sheetNameInput.value.trim(),
              range: rangeInput.value.trim(),
              appsScriptUrl: appsScriptInput.value.trim(),
              apiKey: apiKeyInput.value.trim(),
            });
            const result = await syncFromSheet();
            if (result.ok) emit(EVENTS.VIEW_REFRESH);
          });
        },
      }, [icon('i-link'), el('span', { text: 'Connect & Sync' })]),
      el('a', {
        class: 'btn btn--outline btn--sm',
        href: './docs/GOOGLE_SHEETS_SETUP.md',
        target: '_blank',
        rel: 'noopener',
        text: 'Read the sheet setup guide',
      }),
    ]),
    el('details', { style: { marginTop: '16px' } }, [
      el('summary', { class: 'small', style: { cursor: 'pointer' }, text: 'Advanced: private sheets (Apps Script) and API key' }),
      el('div', { style: { marginTop: '12px' } }, [
        el('div', { class: 'field' }, [
          el('label', { text: 'Google Apps Script Web App URL (recommended for private sheets)' }),
          appsScriptInput,
          el('span', { class: 'field__hint', text: 'Paste the /exec URL of your deployed script. It runs inside your own Google account, so the sheet never has to be public. The setup guide includes the ready-made script.' }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Google Sheets API key (optional)' }),
          apiKeyInput,
          el('span', { class: 'field__hint', text: 'Only useful for sheets that are already public. Never paste a key you use for billing-critical systems.' }),
        ]),
      ]),
    ]),
  ]));
  wrap.appendChild(connectPanel);

  /* column mapping ------------------------------------------------------ */
  wrap.appendChild(columnMappingPanel());

  /* sync options -------------------------------------------------------- */
  const autoSyncToggle = el('input', {
    type: 'checkbox',
    checked: Boolean(sheet.autoSyncEnabled),
    onchange: (event) => {
      updateSheetConfig({ autoSyncEnabled: event.target.checked });
      notify.info(event.target.checked ? 'Auto-sync enabled while My CRM is open.' : 'Auto-sync disabled.');
      emit(EVENTS.VIEW_REFRESH);
    },
  });
  const intervalSelect = el('select', {
    onchange: (event) => updateSheetConfig({ autoSyncMinutes: Number(event.target.value) }),
  });
  for (const minutes of [5, 15, 30, 60]) {
    intervalSelect.appendChild(el('option', { value: String(minutes), text: `Every ${minutes} minutes`, selected: Number(sheet.autoSyncMinutes) === minutes }));
  }

  const writeBackToggle = el('input', {
    type: 'checkbox',
    checked: Boolean(store.get('settings').sheetWriteBackEnabled),
    onchange: async (event) => {
      if (event.target.checked) {
        const confirmed = await confirmDialog({
          title: 'Allow writing back to your Google Sheet?',
          message: 'My CRM will ask for confirmation every single time before it changes a cell, and it will only update the row of the lead you are editing.',
          confirmLabel: 'I understand, enable',
          details: 'Writing requires an Apps Script URL that allows writes (the script in the setup guide does).',
        });
        if (!confirmed) { event.target.checked = false; return; }
      }
      updateSettings({ sheetWriteBackEnabled: event.target.checked });
      notify.info(event.target.checked ? 'Write-back enabled (still asks for confirmation each time).' : 'Write-back disabled.');
    },
  });

  const syncPanel = el('section', { class: 'panel' });
  syncPanel.appendChild(el('div', { class: 'panel__head' }, [el('h2', {}, [icon('i-refresh'), el('span', { text: 'Sync behaviour' })])]));
  syncPanel.appendChild(el('div', { class: 'panel__body' }, [
    el('div', { class: 'stack' }, [
      el('label', { class: 'checkbox' }, [autoSyncToggle, el('span', { text: 'Refresh from the sheet automatically while My CRM is open' })]),
      el('div', { class: 'field', style: { maxWidth: '220px' } }, [el('label', { text: 'Auto-sync interval' }), intervalSelect]),
      el('label', { class: 'checkbox' }, [writeBackToggle, el('span', { text: 'Allow writing changes back to the sheet (always asks first)' })]),
      el('p', { class: 'small muted', text: 'My CRM never modifies your sheet on its own. Merging is one-way by default: the sheet is the source of truth for the columns it owns, and your CRM-only data (notes, timeline, AI suggestions) stays on this device.' }),
    ]),
  ]));
  wrap.appendChild(syncPanel);

  return wrap;
}

function columnMappingPanel() {
  const sheet = store.get('sheet');
  const headers = detectedHeaders.length ? detectedHeaders : (sheet.headers || []);
  const panel = el('section', { class: 'panel' });

  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-filter'), el('span', { text: 'Column mapping' })]),
    el('span', { class: 'spacer' }),
    headers.length ? badge(`${headers.length} columns detected`, 'green') : badge('Sync once to detect columns', 'outline'),
  ]));

  if (!headers.length) {
    panel.appendChild(el('div', { class: 'panel__body' }, [
      el('p', { class: 'muted small', text: 'After the first successful sync, every column in your sheet appears here so you can correct the automatic mapping (for example CRM "Phone" → sheet "Contact Number").' }),
    ]));
    return panel;
  }

  const selects = {};
  const body = el('div', { class: 'panel__body' });
  const grid = el('div', { class: 'filter-grid' });

  for (const field of CRM_FIELDS) {
    const select = el('select', { 'aria-label': field.label });
    select.appendChild(el('option', { value: '', text: '— not mapped —', selected: !sheet.columns?.[field.key] }));
    for (const header of headers) {
      select.appendChild(el('option', { value: header, text: header, selected: sheet.columns?.[field.key] === header }));
    }
    selects[field.key] = select;
    grid.appendChild(el('div', { class: 'field' }, [
      el('label', { text: `${field.label}${field.required ? ' *' : ''}` }),
      select,
    ]));
  }
  body.appendChild(grid);

  body.appendChild(el('div', { class: 'btn-group', style: { marginTop: '12px' } }, [
    el('button', {
      class: 'btn btn--sm btn--primary',
      type: 'button',
      onclick: () => {
        const columns = {};
        for (const [key, select] of Object.entries(selects)) {
          if (select.value) columns[key] = select.value;
        }
        if (!columns.name) {
          notify.warn('Please map a column to "Lead Name" — every lead needs a name.');
          return;
        }
        updateSheetConfig({ columns });
        notify.success('Column mapping saved. Sync again to apply it.');
        emit(EVENTS.VIEW_REFRESH);
      },
    }, [icon('i-check'), el('span', { text: 'Save mapping' })]),
    el('button', {
      class: 'btn btn--sm btn--outline',
      type: 'button',
      text: 'Re-detect automatically',
      onclick: () => {
        updateSheetConfig({ columns: {} });
        notify.info('Mapping cleared — My CRM will detect the columns on the next sync.');
        emit(EVENTS.VIEW_REFRESH);
      },
    }),
  ]));

  panel.appendChild(body);
  return panel;
}

function openPreviewModal() {
  const modal = openModal({
    title: 'Preview your sheet',
    subtitle: 'Check the first rows and how the columns were mapped.',
    body: el('p', { class: 'muted', text: 'Reading the sheet…' }),
    footer: [{ label: 'Close', class: 'btn btn--outline', onClick: () => {} }],
  });
  if (!modal) return;

  previewSheet(store.get('sheet'), { headerRow: store.get('sheet').headerRow })
    .then((result) => {
      detectedHeaders = result.headers;
      updateSheetConfig({ headers: result.headers });
      const body = el('div');
      body.appendChild(el('div', { class: 'kv-inline', style: { marginBottom: '10px' } }, [
        badge(`${result.headers.length} columns`, 'outline'),
        badge(`${result.totalRows} rows`, 'outline'),
        badge(`Read via ${result.via}`, 'green'),
      ]));
      body.appendChild(el('div', { class: 'ai-block__label', text: 'Detected mapping' }));
      const mapping = el('dl', { class: 'def-list' }, MAPPABLE_FIELDS.map((field) => {
        const header = result.analysis.mapping[field.key];
        return [
          el('dt', { text: field.label }),
          el('dd', {}, [header ? el('span', { text: header }) : el('span', { class: 'muted', text: 'not mapped' })]),
        ];
      }).flat());

      const warnings = result.analysis.warnings || [];
      body.appendChild(mapping);
      if (warnings.length) {
        const list = el('div', { class: 'stack', style: { marginTop: '12px' } });
        for (const warning of warnings) {
          list.appendChild(el('div', { class: `banner banner--${warning.level === 'error' ? 'error' : warning.level === 'warn' ? 'warn' : 'info'}` }, [
            icon('i-alert'),
            el('div', { text: warning.message }),
          ]));
        }
        body.appendChild(list);
      }

      body.appendChild(el('div', { class: 'ai-block__label', style: { marginTop: '14px' }, text: 'First rows' }));
      const table = el('table', { class: 'simple' }, [
        el('thead', {}, [el('tr', {}, result.headers.slice(0, 8).map((h) => el('th', { text: h })))]),
        el('tbody', {}, result.records.slice(0, 5).map((row) => el('tr', {}, result.headers.slice(0, 8).map((h) => el('td', { text: row[h] || '—' }))))),
      ]);
      body.appendChild(el('div', { class: 'table-wrap' }, [table]));

      clear(modal.body);
      modal.body.appendChild(body);
    })
    .catch((error) => {
      clear(modal.body);
      modal.body.appendChild(el('div', { class: 'banner banner--error' }, [
        icon('i-alert'),
        el('div', {}, [
          el('strong', { text: 'Could not read the sheet.' }),
          el('p', { class: 'small', text: error.friendly || error.message || 'Unknown error' }),
          el('p', { class: 'small', text: 'Tip: set the sheet sharing to "Anyone with the link – Viewer", or use the Apps Script method for private sheets.' }),
        ]),
      ]));
    });
}

/* --------------------------------------------------------------- AI tab -- */

function aiTab() {
  const settings = store.get('settings');
  const status = aiStatus(settings);
  const wrap = el('div', { class: 'stack' });

  const statusPanel = el('section', { class: 'panel' });
  statusPanel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-sparkles'), el('span', { text: 'AI status' })]),
    el('span', { class: 'spacer' }),
    status.ok ? badge('Ready', 'green', 'badge--dot') : badge('Using built-in suggestions', 'orange', 'badge--dot'),
  ]));
  statusPanel.appendChild(el('div', { class: 'panel__body' }, [
    el('p', { text: status.label }),
    el('p', { class: 'small muted', text: status.hint }),
    el('p', { class: 'small muted', text: 'My CRM keeps working without AI: every analysis, message and summary has a built-in equivalent generated on your device.' }),
  ]));
  wrap.appendChild(statusPanel);

  /* key ---------------------------------------------------------------- */
  const keyInput = el('input', {
    type: 'password',
    value: settings.geminiApiKey || '',
    placeholder: 'AIza…',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const modelSelect = el('select', { onchange: (event) => { updateSettings({ geminiModel: event.target.value }); emit(EVENTS.VIEW_REFRESH); } });
  const models = [
    ['gemini-2.0-flash', 'gemini-2.0-flash — fast and cheap (recommended)'],
    ['gemini-2.5-flash', 'gemini-2.5-flash — newer, still fast'],
    ['gemini-2.5-pro', 'gemini-2.5-pro — best quality, slower'],
    ['gemini-flash-latest', 'gemini-flash-latest — always the newest flash model'],
  ];
  for (const [value, label] of models) {
    modelSelect.appendChild(el('option', { value, text: label, selected: settings.geminiModel === value }));
  }
  if (!models.some(([value]) => value === settings.geminiModel)) {
    modelSelect.appendChild(el('option', { value: settings.geminiModel, text: settings.geminiModel, selected: true }));
  }
  const customModel = el('input', {
    type: 'text',
    value: settings.geminiModel,
    placeholder: 'Type any Gemini model id',
  });

  const keyPanel = el('section', { class: 'panel' });
  keyPanel.appendChild(el('div', { class: 'panel__head' }, [el('h2', {}, [icon('i-wand'), el('span', { text: 'Gemini API key' })])]));
  keyPanel.appendChild(el('div', { class: 'panel__body' }, [
    el('div', { class: 'field' }, [
      el('label', { text: 'API key', for: 'gemini-key' }),
      el('div', { class: 'row', style: { alignItems: 'stretch' } }, [
        el('div', { class: 'grow' }, [keyInput]),
        el('button', {
          class: 'btn btn--outline btn--sm',
          type: 'button',
          text: 'Show',
          onclick: (event) => {
            keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
            event.currentTarget.textContent = keyInput.type === 'password' ? 'Show' : 'Hide';
          },
        }),
      ]),
      el('span', { class: 'field__hint', text: 'Get a free key at aistudio.google.com/apikey. The key is stored only in this browser (localStorage) and is sent straight to Google.' }),
    ]),
    el('div', { class: 'field', style: { maxWidth: '380px' } }, [el('label', { text: 'Model' }), modelSelect]),
    el('details', {}, [
      el('summary', { class: 'small', style: { cursor: 'pointer' }, text: 'Use a different model id' }),
      el('div', { class: 'field', style: { marginTop: '8px', maxWidth: '380px' } }, [
        el('label', { text: 'Custom model id' }),
        customModel,
        el('span', { class: 'field__hint', text: 'Only change this if Google releases a model you specifically want to use.' }),
      ]),
    ]),
    el('div', { class: 'btn-group', style: { marginTop: '12px' } }, [
      el('button', {
        class: 'btn btn--primary btn--sm',
        type: 'button',
        onclick: async (event) => {
          updateSettings({ geminiApiKey: keyInput.value.trim(), geminiModel: customModel.value.trim() || settings.geminiModel });
          await withBusy(event.currentTarget, 'Testing…', async () => {
            const result = await testConnection(store.get('settings'));
            if (result.ok) notify.success(result.message, { title: 'Gemini connected' });
            else notify.error(result.message, { title: 'Connection failed' });
          });
          emit(EVENTS.VIEW_REFRESH);
        },
      }, [icon('i-check'), el('span', { text: 'Save & test connection' })]),
      el('button', {
        class: 'btn btn--outline btn--sm',
        type: 'button',
        text: 'Save key only',
        onclick: () => {
          updateSettings({ geminiApiKey: keyInput.value.trim(), geminiModel: customModel.value.trim() || settings.geminiModel });
          notify.success('API key saved to this browser.');
        },
      }),
      settings.geminiApiKey ? el('button', {
        class: 'btn btn--danger btn--sm',
        type: 'button',
        text: 'Remove key',
        onclick: async () => {
          const confirmed = await confirmDialog({
            title: 'Remove the Gemini API key?',
            message: 'AI features switch to the built-in suggestions. Your leads are not affected.',
            confirmLabel: 'Remove key',
            danger: true,
          });
          if (!confirmed) return;
          updateSettings({ geminiApiKey: '' });
          notify.info('Gemini API key removed.');
          emit(EVENTS.VIEW_REFRESH);
        },
      }) : null,
    ]),
    el('div', { class: 'banner banner--warn', style: { marginTop: '16px' } }, [
      icon('i-shield'),
      el('div', {}, [
        el('strong', { text: 'Browser-side keys are an MVP compromise.' }),
        el('p', { class: 'small', text: 'Anyone with access to this browser profile can read the key from local storage. That is acceptable for a personal tool on your own device, but not for a shared or public deployment. For production, deploy the serverless proxy (netlify/functions/gemini.mjs or the Apps Script version) and set the proxy URL below — the key then stays on the server.' }),
      ]),
    ]),
    el('div', { class: 'field', style: { marginTop: '12px' } }, [
      el('label', { text: 'Serverless AI proxy URL (optional, recommended for production)' }),
      el('input', {
        type: 'url',
        value: settings.aiProxyUrl || '',
        placeholder: 'https://your-site.netlify.app/api/gemini',
        onchange: (event) => {
          updateSettings({ aiProxyUrl: event.target.value.trim() });
          notify.info(event.target.value.trim() ? 'Requests will be sent through your proxy.' : 'Proxy removed — using the direct key.');
        },
      }),
      el('span', { class: 'field__hint', text: 'When set, the browser never sends your API key to Google; it calls your endpoint instead.' }),
    ]),
  ]));
  wrap.appendChild(keyPanel);

  /* assistant settings -------------------------------------------------- */
  const greetingSelect = el('select', {
    onchange: (event) => { updateSettings({ messageGreeting: event.target.value }); notify.info('Greeting style saved.'); },
  });
  for (const [value, label] of [['auto', 'Auto (mix of greetings)'], ['salam', 'Assalam o Alaikum'], ['hello', 'Hello / Hi'], ['formal', 'Dear (formal)']]) {
    greetingSelect.appendChild(el('option', { value, text: label, selected: settings.messageGreeting === value }));
  }

  const assistantPanel = el('section', { class: 'panel' });
  assistantPanel.appendChild(el('div', { class: 'panel__head' }, [el('h2', {}, [icon('i-user'), el('span', { text: 'Your details & assistant behaviour' })])]));
  assistantPanel.appendChild(el('div', { class: 'panel__body' }, [
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [
        el('label', { text: 'Your name (used to sign messages)' }),
        el('input', {
          type: 'text',
          value: settings.senderName || '',
          placeholder: 'e.g. Ahmed',
          onchange: (event) => { updateSettings({ senderName: event.target.value.trim() }); notify.info('Saved.'); },
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Business / institute name' }),
        el('input', {
          type: 'text',
          value: settings.businessName || '',
          placeholder: 'e.g. Safety First Training Institute',
          onchange: (event) => { updateSettings({ businessName: event.target.value.trim() }); notify.info('Saved.'); },
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Message greeting style' }),
        greetingSelect,
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Default country code (for local WhatsApp numbers)' }),
        el('input', {
          type: 'text',
          value: settings.countryCode || '',
          placeholder: 'e.g. 92',
          onchange: (event) => { updateSettings({ countryCode: event.target.value.replace(/\D/g, '') }); notify.info('Saved.'); },
        }),
      ]),
    ]),
    el('label', { class: 'checkbox' }, [
      el('input', {
        type: 'checkbox',
        checked: settings.aiMinimalPayload !== false,
        onchange: (event) => { updateSettings({ aiMinimalPayload: event.target.checked }); emit(EVENTS.VIEW_REFRESH); },
      }),
      el('span', { text: 'Send the minimum lead data to the AI (recommended — full name is shortened to "First L." and long notes are trimmed)' }),
    ]),
    el('label', { class: 'checkbox', style: { marginTop: '10px' } }, [
      el('input', {
        type: 'checkbox',
        checked: settings.aiCacheEnabled !== false,
        onchange: (event) => { updateSettings({ aiCacheEnabled: event.target.checked }); notify.info(event.target.checked ? 'Result caching enabled.' : 'Result caching disabled.'); },
      }),
      el('span', { text: 'Cache AI results until a lead actually changes (saves quota and keeps the UI fast)' }),
    ]),
    el('div', { class: 'btn-group', style: { marginTop: '12px' } }, [
      el('button', {
        class: 'btn btn--outline btn--sm',
        type: 'button',
        text: 'Clear AI cache',
        onclick: () => {
          clearAiCache();
          notify.success('AI cache cleared — the next analysis runs fresh.');
          emit(EVENTS.VIEW_REFRESH);
        },
      }),
    ]),
  ]));
  wrap.appendChild(assistantPanel);

  return wrap;
}

/* ---------------------------------------------------------- privacy tab -- */

function privacyTab() {
  const leads = currentLeads();
  const wrap = el('div', { class: 'stack' });

  const panel = el('section', { class: 'panel' });
  panel.appendChild(el('div', { class: 'panel__head' }, [el('h2', {}, [icon('i-shield'), el('span', { text: 'Your data, plainly explained' })])]));
  panel.appendChild(el('div', { class: 'panel__body' }, [
    el('ul', { style: { margin: '0 0 0 18px', padding: 0, lineHeight: 1.7 } }, [
      el('li', { text: 'Lead data is private business data. My CRM stores your leads, notes, settings and the AI cache in this browser only (localStorage). There is no My CRM server.' }),
      el('li', { text: 'Your Gemini API key is stored in the same browser storage. It is never sent anywhere except Google (or your own proxy).' }),
      el('li', { text: 'Only the minimum information required is sent to the AI: one lead at a time for analysis and messages, and aggregate counts for marketing insights. Your whole sheet is never uploaded.' }),
      el('li', { text: 'Passwords, customer message logs and unnecessary personal fields are never sent to the AI. Notes are trimmed to 300 characters.' }),
      el('li', { text: 'Nothing is logged to a third-party service. Errors stay in your browser console.' }),
      el('li', { text: 'Export or delete everything at any time with the buttons below.' }),
    ]),
  ]));
  wrap.appendChild(panel);

  const storagePanel = el('section', { class: 'panel' });
  storagePanel.appendChild(el('div', { class: 'panel__head' }, [el('h2', {}, [icon('i-download'), el('span', { text: 'Stored data & storage' })])]));
  const storageBody = el('div', { class: 'panel__body' });
  storageBody.appendChild(el('div', { class: 'grid grid--stats' }, [
    statTile({ value: leads.length, label: 'Leads stored' }),
    statTile({ value: Object.keys(store.get('aiCache') || {}).length, label: 'Cached AI results' }),
    statTile({ value: storage.isPersistent() ? 'Yes' : 'No', label: 'Persistent storage', tone: storage.isPersistent() ? 'green' : 'orange', hint: storage.isPersistent() ? 'Survives refresh' : 'Data lost on refresh' }),
  ]));

  storageBody.appendChild(el('div', { class: 'btn-group', style: { marginTop: '14px' } }, [
    el('button', {
      class: 'btn btn--outline btn--sm',
      type: 'button',
      text: 'Export all data (JSON backup)',
      onclick: () => {
        const payload = {
          exportedAt: new Date().toISOString(),
          app: 'My CRM',
          settings: { ...store.get('settings'), geminiApiKey: store.get('settings').geminiApiKey ? '***REDACTED***' : '' },
          sheet: store.get('sheet'),
          source: store.get('source'),
          leads,
        };
        downloadTextFile(`my-crm-backup-${formatDate(new Date(), 'short').replace(/\s/g, '-')}.json`, JSON.stringify(payload, null, 2), 'application/json');
        notify.success('Backup downloaded (API key removed from the export).');
      },
    }),
    el('button', {
      class: 'btn btn--outline btn--sm',
      type: 'button',
      text: 'Export leads as CSV',
      onclick: () => {
        const csv = objectsToCSV(leads.map((lead) => ({
          Name: lead.name, Phone: lead.phone, WhatsApp: lead.whatsapp, Email: lead.email,
          Course: lead.course, City: lead.city, Source: lead.source, Status: lead.status,
          Interest: lead.interest, 'Last Contact': lead.lastContact, 'Next Follow-up': lead.nextFollowUp,
          Notes: lead.notes, 'Assigned To': lead.assignedTo, 'Follow-ups': lead.followUpCount,
        })));
        downloadTextFile('my-crm-leads.csv', csv, 'text/csv;charset=utf-8');
      },
    }),
    el('button', {
      class: 'btn btn--outline btn--sm',
      type: 'button',
      text: 'Download the demo sheet template (CSV)',
      onclick: () => downloadTextFile('my-crm-example-leads.csv', demoSheetCsv(), 'text/csv;charset=utf-8'),
    }),
    el('button', {
      class: 'btn btn--outline btn--sm',
      type: 'button',
      text: 'Load demo data',
      onclick: () => { loadDemoData(); emit(EVENTS.VIEW_REFRESH); },
    }),
  ]));

  storageBody.appendChild(el('div', { class: 'btn-group', style: { marginTop: '16px' } }, [
    el('button', {
      class: 'btn btn--danger btn--sm',
      type: 'button',
      text: 'Delete all leads on this device',
      onclick: async () => {
        const confirmed = await confirmDialog({
          title: 'Delete every lead stored in My CRM?',
          message: 'This only clears this browser. Your Google Sheet is not changed.',
          confirmLabel: 'Delete all leads',
          danger: true,
        });
        if (!confirmed) return;
        clearAllLeads();
        notify.success('All leads removed from this device.');
        emit(EVENTS.VIEW_REFRESH);
      },
    }),
    el('button', {
      class: 'btn btn--danger-solid btn--sm',
      type: 'button',
      text: 'Disconnect Google Sheet & remove stored configuration',
      onclick: async () => {
        const confirmed = await confirmDialog({
          title: 'Remove all stored configuration?',
          message: 'This deletes your leads, settings, the sheet connection, your API key and the AI cache from this browser. You can reconnect at any time.',
          confirmLabel: 'Remove everything',
          danger: true,
        });
        if (!confirmed) return;
        purgeAllData();
        notify.success('Everything stored by My CRM has been removed.');
        setTimeout(() => window.location.reload(), 700);
      },
    }),
  ]));
  storagePanel.appendChild(storageBody);
  wrap.appendChild(storagePanel);

  const activity = store.get('activity') || [];
  if (activity.length) {
    const activityPanel = el('section', { class: 'panel' });
    activityPanel.appendChild(el('div', { class: 'panel__head' }, [el('h2', {}, [icon('i-clock'), el('span', { text: 'Recent app activity' })])]));
    activityPanel.appendChild(el('div', { class: 'panel__body' }, [
      el('ul', { style: { margin: 0, paddingLeft: '18px', lineHeight: 1.7 } }, activity.slice(0, 10).map((entry) => el('li', {
        class: 'small',
        text: `${formatDate(entry.at)} — ${entry.text}`,
      }))),
    ]));
    wrap.appendChild(activityPanel);
  }

  return wrap;
}

/* ------------------------------------------------------------- help tab -- */

function helpTab() {
  const wrap = el('div', { class: 'stack' });

  const columnsPanel = el('section', { class: 'panel' });
  columnsPanel.appendChild(el('div', { class: 'panel__head' }, [el('h2', {}, [icon('i-sheet'), el('span', { text: 'Recommended Google Sheet structure' })]), el('span', { class: 'badge badge--outline', text: `${DEMO_HEADERS.length} columns` })]));
  columnsPanel.appendChild(el('div', { class: 'panel__body' }, [
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'simple' }, [
        el('thead', {}, [el('tr', {}, DEMO_HEADERS.map((h) => el('th', { text: h })))]),
        el('tbody', {}, [
          el('tr', {}, ['Ahmed Raza', '+92 300 1234567', '+92 300 1234567', 'ahmed@example.com', 'NVQ Level 6 Diploma in OHS', 'Karachi', 'Facebook', 'Hot', 'Hot', '01/09/2026', '05/09/2026', 'Asked for fees', 'Ahmed', '3', 'Send fee details'].map((cell) => el('td', { text: cell }))),
        ]),
      ]),
    ]),
    el('p', { class: 'small muted', style: { marginTop: '10px' }, text: 'Only "Name" is essential. Any column order works, extra columns are preserved, and dates can be written as 05/09/2026, 2026-09-05 or 5 Sep 2026.' }),
    el('div', { class: 'btn-group', style: { marginTop: '10px' } }, [
      el('a', { class: 'btn btn--sm btn--outline', href: './docs/GOOGLE_SHEETS_SETUP.md', target: '_blank', rel: 'noopener', text: 'Sheet setup guide' }),
      el('a', { class: 'btn btn--sm btn--outline', href: './docs/GEMINI_API_KEY.md', target: '_blank', rel: 'noopener', text: 'Gemini key guide' }),
      el('a', { class: 'btn btn--sm btn--outline', href: './docs/DEPLOYMENT.md', target: '_blank', rel: 'noopener', text: 'Deployment guide' }),
      el('a', { class: 'btn btn--sm btn--outline', href: './docs/PRIVACY_AND_SECURITY.md', target: '_blank', rel: 'noopener', text: 'Privacy & security' }),
    ]),
  ]));
  wrap.appendChild(columnsPanel);

  const helpPanel = el('section', { class: 'panel' });
  helpPanel.appendChild(el('div', { class: 'panel__head' }, [el('h2', {}, [icon('i-alert'), el('span', { text: 'Troubleshooting' })])]));
  helpPanel.appendChild(el('div', { class: 'panel__body' }, [
    el('div', { class: 'stack' }, [
      help('The sync says the sheet is not public', 'Open the sheet → Share → General access → "Anyone with the link" → Viewer. For a private sheet, use the Apps Script method (guide linked above) — it keeps the sheet private.'),
      help('Dates look wrong after import', 'My CRM reads day-first dates (05/09/2026 = 5 September). If your sheet uses month-first, either switch the column format to an ISO date (2026-09-05) or correct the dates in the lead form once and the mapping will hold.'),
      help('AI says "your key was rejected"', 'Create a new key at aistudio.google.com/apikey and paste it in Settings → AI & Gemini. Keys start with "AIza". Free-tier keys are rate limited — the CRM then falls back to its built-in suggestions, which is normal.'),
      help('AI returns "quota used up"', 'The free tier allows a limited number of requests per minute and per day. Wait a little, or add billing to your Google Cloud project. The CRM keeps working in the meantime.'),
      help('The dashboard shows no leads', 'Load the demo data (Settings → Data & privacy) or connect your Google Sheet (Settings → Google Sheet). Everything is stored in this browser, so a different browser or device shows its own copy.'),
      help('My data disappeared', 'Private/incognito windows and "clear browsing data" delete localStorage. Keep a JSON backup (Settings → Data & privacy → Export all data).'),
    ]),
  ]));
  wrap.appendChild(helpPanel);

  const aboutPanel = el('section', { class: 'panel' });
  aboutPanel.appendChild(el('div', { class: 'panel__head' }, [el('h2', {}, [icon('i-sparkles'), el('span', { text: 'About My CRM' })])]));
  aboutPanel.appendChild(el('div', { class: 'panel__body' }, [
    el('p', { class: 'small', text: 'My CRM — a lightweight AI lead-management and follow-up dashboard for teams that keep their leads in Google Sheets. Version 1.0 (MVP).' }),
    el('p', { class: 'small muted', text: 'Built to be extended: Firebase/Supabase, WhatsApp Business API, email integration and team logins can be added behind the same data layer.' }),
  ]));
  wrap.appendChild(aboutPanel);

  return wrap;
}

function help(title, body) {
  return el('div', {}, [
    el('strong', { class: 'small', text: title }),
    el('p', { class: 'small muted', style: { margin: '2px 0 0' }, text: body }),
  ]);
}

export { activeTab as settingsTab };
