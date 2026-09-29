/** Add / edit lead modal (shared by the Leads page, dashboard and profile). */

import { el, focusFirst, clear } from '../lib/dom.js';
import { openModal, notify, confirmDialog } from '../ui/kit.js';
import { todayISO, addDaysISO } from '../lib/date.js';
import { COURSES, INTEREST_LEVELS, LEAD_STATUSES, SOURCES } from '../config.js';
import { distinctValues } from '../domain/model.js';
import { currentLeads, saveLeadFromForm, deleteLead } from '../services/actions.js';

/**
 * Open the add/edit lead form.
 * @param {{lead?:object, onSaved?:(lead:object)=>void}} options
 */
export function openLeadForm({ lead = null, onSaved = null } = {}) {
  const editing = Boolean(lead);
  const leads = currentLeads();
  const cities = distinctValues(leads, 'city');
  const assignees = distinctValues(leads, 'assignedTo');

  const field = (label, control, hint = '') => el('div', { class: 'field' }, [
    el('label', { for: control.id, text: label }),
    control,
    hint ? el('span', { class: 'field__hint', text: hint }) : null,
  ]);

  const textInput = (name, value, extra = {}) => el('input', {
    id: `lead-${name}`,
    name,
    type: extra.type || 'text',
    value: value || '',
    placeholder: extra.placeholder || '',
    autocomplete: extra.autocomplete || 'off',
    list: extra.list || undefined,
  });

  const select = (name, value, options) => {
    const node = el('select', { id: `lead-${name}`, name });
    for (const option of options) {
      node.appendChild(el('option', {
        value: option,
        text: option,
        selected: option === value,
      }));
    }
    if (value && !options.includes(value)) {
      node.appendChild(el('option', { value, text: value, selected: true }));
    }
    return node;
  };

  const nameInput = textInput('name', lead?.name, { placeholder: 'e.g. Ahmed Raza', autocomplete: 'name' });
  const phoneInput = textInput('phone', lead?.phone, { type: 'tel', placeholder: '+92 300 1234567', autocomplete: 'tel' });
  const whatsappInput = textInput('whatsapp', lead?.whatsapp, { type: 'tel', placeholder: 'Same as phone if left blank' });
  const emailInput = textInput('email', lead?.email, { type: 'email', placeholder: 'name@example.com', autocomplete: 'email' });

  const courseListId = 'lead-course-options';
  const courseSelect = select('course', lead?.course, ['', ...COURSES]);
  courseSelect.setAttribute('list', courseListId);
  const courseInput = textInput('course', lead?.course, { list: courseListId, placeholder: 'Type or choose a course' });

  const cityInput = textInput('city', lead?.city, { list: 'lead-city-options', placeholder: 'e.g. Karachi' });
  const sourceSelect = select('source', lead?.source || '', ['', ...SOURCES]);
  const statusSelect = select('status', lead?.status || 'New', LEAD_STATUSES);
  const interestSelect = select('interest', lead?.interest || 'Cold', INTEREST_LEVELS);
  const assignedInput = textInput('assignedTo', lead?.assignedTo, { list: 'lead-assignee-options', placeholder: 'Who owns this lead?' });
  const followCountInput = textInput('followUpCount', String(lead?.followUpCount ?? 0), { type: 'number' });
  const lastContactInput = el('input', { id: 'lead-lastContact', name: 'lastContact', type: 'date', value: lead?.lastContact || '' });
  const nextFollowUpInput = el('input', { id: 'lead-nextFollowUp', name: 'nextFollowUp', type: 'date', value: lead?.nextFollowUp || '' });
  const lastResponseInput = textInput('lastResponse', lead?.lastResponse, { placeholder: 'What did the lead say last?' });
  const notesInput = el('textarea', { id: 'lead-notes', name: 'notes', placeholder: 'Anything useful: budget, timing, objections…' });
  notesInput.value = lead?.notes || '';

  const quickDates = el('div', { class: 'btn-group', style: { marginTop: '6px' } }, [
    el('button', { class: 'btn btn--xs btn--outline', type: 'button', text: 'Today', onclick: () => { nextFollowUpInput.value = todayISO(); } }),
    el('button', { class: 'btn btn--xs btn--outline', type: 'button', text: 'Tomorrow', onclick: () => { nextFollowUpInput.value = addDaysISO(todayISO(), 1); } }),
    el('button', { class: 'btn btn--xs btn--outline', type: 'button', text: 'In 3 days', onclick: () => { nextFollowUpInput.value = addDaysISO(todayISO(), 3); } }),
    el('button', { class: 'btn btn--xs btn--outline', type: 'button', text: 'Next week', onclick: () => { nextFollowUpInput.value = addDaysISO(todayISO(), 7); } }),
  ]);

  const errorBox = el('div', { class: 'field__error', hidden: true });

  const form = el('form', { class: 'lead-form', novalidate: true, onsubmit: (e) => e.preventDefault() }, [
    errorBox,
    el('div', { class: 'form-grid' }, [
      field('Lead name *', nameInput),
      field('Phone', phoneInput),
      field('WhatsApp', whatsappInput),
      field('Email', emailInput),
    ]),
    el('div', { class: 'form-grid' }, [
      field('Course', courseInput, 'Pick a standard course or type your own'),
      field('City', cityInput),
      field('Source', sourceSelect),
      field('Assigned to', assignedInput),
    ]),
    el('div', { class: 'form-grid form-grid--3' }, [
      field('Status', statusSelect),
      field('Interest level', interestSelect),
      field('Follow-ups made', followCountInput),
    ]),
    el('div', { class: 'form-grid' }, [
      field('Last contact', lastContactInput),
      el('div', { class: 'field' }, [
        el('label', { for: 'lead-nextFollowUp', text: 'Next follow-up' }),
        nextFollowUpInput,
        quickDates,
      ]),
    ]),
    field('Last response', lastResponseInput, 'e.g. "Asked for the fee structure"'),
    field('Notes', notesInput),
    el('datalist', { id: courseListId }, COURSES.map((c) => el('option', { value: c }))),
    el('datalist', { id: 'lead-city-options' }, cities.map((c) => el('option', { value: c }))),
    el('datalist', { id: 'lead-assignee-options' }, assignees.map((a) => el('option', { value: a }))),
  ]);

  const collect = () => ({
    name: nameInput.value.trim(),
    phone: phoneInput.value.trim(),
    whatsapp: whatsappInput.value.trim(),
    email: emailInput.value.trim(),
    course: courseInput.value.trim(),
    city: cityInput.value.trim(),
    source: sourceSelect.value,
    status: statusSelect.value,
    interest: interestSelect.value,
    assignedTo: assignedInput.value.trim(),
    followUpCount: followCountInput.value,
    lastContact: lastContactInput.value,
    nextFollowUp: nextFollowUpInput.value,
    lastResponse: lastResponseInput.value.trim(),
    notes: notesInput.value.trim(),
  });

  const modal = openModal({
    title: editing ? `Edit ${lead.name}` : 'Add a new lead',
    subtitle: editing ? 'Update the details and save.' : 'Only the name and one contact method are required.',
    body: form,
    size: 'modal--lg',
    footer: [
      editing ? {
        label: 'Delete lead',
        class: 'btn btn--danger',
        onClick: async () => {
          const confirmed = await confirmDialog({
            title: `Delete ${lead.name}?`,
            message: 'This removes the lead and its activity timeline from My CRM. Your Google Sheet is not touched.',
            confirmLabel: 'Delete lead',
            danger: true,
          });
          if (confirmed) {
            deleteLead(lead.id);
            notify.success(`${lead.name} deleted.`);
            onSaved?.(null);
          }
        },
      } : null,
      { label: 'Cancel', class: 'btn btn--ghost', onClick: () => {} },
      {
        label: editing ? 'Save changes' : 'Add lead',
        class: 'btn btn--primary',
        close: false,
        onClick: (event, api) => {
          const result = saveLeadFromForm(collect(), { leadId: editing ? lead.id : null });
          if (!result.ok) {
            showErrors(result.errors);
            notify.warn('Please check the highlighted fields.');
            return;
          }
          hideErrors();
          notify.success(editing ? `${result.lead.name} updated.` : `${result.lead.name} added to your leads.`);
          api.close();
          onSaved?.(result.lead);
        },
      },
    ],
  });

  function showErrors(errors) {
    clear(errorBox);
    const entries = Object.entries(errors || {});
    errorBox.hidden = entries.length === 0;
    for (const [field0, message] of entries) {
      errorBox.appendChild(el('div', { text: message }));
      const input = form.querySelector(`[name="${field0}"]`);
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        input.addEventListener('input', () => input.removeAttribute('aria-invalid'), { once: true });
      }
    }
    const firstInvalid = form.querySelector('[aria-invalid="true"]');
    if (firstInvalid) firstInvalid.focus();
  }

  function hideErrors() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  if (modal) focusFirst(modal.root, '#lead-name');
  return modal;
}

export { maybePrefillFromQuery };

function maybePrefillFromQuery() {
  // Reserved for future deep-linking such as #/leads?new=1 — kept intentionally simple.
}
