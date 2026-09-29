/** Campaign audience definitions (section 19). */

import { daysSinceContact, hasReplied, isClosed } from './followup.js';

/**
 * Select the leads that make up a campaign audience.
 * @param {Array} leads
 * @param {{course?:string, audience?:string, city?:string, status?:string}} criteria
 */
export function buildAudience(leads, criteria = {}) {
  const { course = '', audience = 'All leads', city = '', status = '' } = criteria;
  const active = leads.filter((lead) => !isClosed(lead));

  let pool = active;

  switch (audience) {
    case 'Old interested leads':
      pool = active.filter((lead) => ['Interested', 'Follow-up', 'Hot'].includes(lead.status)
        && (daysSinceContact(lead) ?? 0) >= 14);
      break;
    case 'Not-converted leads':
      pool = leads.filter((lead) => !['Converted', 'Lost'].includes(lead.status));
      break;
    case 'New leads':
      pool = active.filter((lead) => lead.status === 'New');
      break;
    case 'Hot leads':
      pool = active.filter((lead) => lead.interest === 'Hot' || lead.status === 'Hot');
      break;
    case 'No-response leads':
      pool = active.filter((lead) => !hasReplied(lead) && (daysSinceContact(lead) ?? 0) >= 5);
      break;
    case 'Specific course leads':
      pool = active.filter((lead) => lead.course === course);
      break;
    case 'Specific city leads':
      pool = active.filter((lead) => lead.city === city);
      break;
    case 'All leads':
    default:
      pool = active;
  }

  if (course) pool = pool.filter((lead) => lead.course === course);
  if (city) pool = pool.filter((lead) => lead.city === city);
  if (status) pool = pool.filter((lead) => lead.status === status);

  return pool;
}

export function describeAudience(state = {}) {
  const bits = [state.audience || 'All leads'];
  if (state.course) bits.push(state.course);
  if (state.city) bits.push(state.city);
  if (state.status) bits.push(state.status);
  return bits.join(' · ');
}
