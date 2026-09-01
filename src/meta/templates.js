/**
 * Which approved template to use, for which job, in which language.
 *
 * Two things make this more than a constant.
 *
 * A template's language versions normally live under one name, and Meta picks
 * the version by the language code you send. That is not what exists here:
 * the English template was submitted under its own name, message_reminder_en.
 * So a name is chosen per language, not a language code per name — assuming
 * otherwise means sending a name that has no version in the language asked
 * for, which Meta rejects outright rather than falling back.
 *
 * And asking permission is not the same sentence as delivering a message.
 * One template did both, worded as the consent request, so a delivered
 * message arrived inside "reply 1 to receive the message" — quoting the
 * message the recipient was already reading.
 *
 * Everything defaults to what is approved today, so an unset variable keeps
 * the current behaviour rather than sending into a template that does not
 * exist. Nothing switches to a template until someone says it is approved.
 */

const CONSENT_HE = {
  name: process.env.META_TEMPLATE_NAME || 'scheduled_message_reminder',
  language: process.env.META_TEMPLATE_LANGUAGE || 'he'
};

const CONSENT_EN = process.env.META_TEMPLATE_NAME_EN
  ? {
      name: process.env.META_TEMPLATE_NAME_EN,
      language: process.env.META_TEMPLATE_LANGUAGE_EN || 'en_US'
    }
  : null;

const DELIVERY_HE = process.env.META_DELIVERY_TEMPLATE_NAME
  ? {
      name: process.env.META_DELIVERY_TEMPLATE_NAME,
      language: process.env.META_DELIVERY_TEMPLATE_LANGUAGE || 'he'
    }
  : null;

const DELIVERY_EN = process.env.META_DELIVERY_TEMPLATE_NAME_EN
  ? {
      name: process.env.META_DELIVERY_TEMPLATE_NAME_EN,
      language: process.env.META_DELIVERY_TEMPLATE_LANGUAGE_EN || 'en_US'
    }
  : null;

const TEMPLATES = {
  consent:  { he: CONSENT_HE,  en: CONSENT_EN },
  delivery: { he: DELIVERY_HE, en: DELIVERY_EN }
};

/**
 * The template to use, falling back along the axis that costs least.
 *
 * A recipient reading a Hebrew template they did not expect is a poor
 * experience. A send that fails because the name has no version in the
 * language requested is no experience at all — they receive nothing. So an
 * unconfigured language falls back to Hebrew, and an unconfigured job falls
 * back to the one template that is known to be approved.
 */
export function resolveTemplate(job, lang = 'he') {
  const forJob = TEMPLATES[job] || TEMPLATES.consent;
  return forJob[lang] || forJob.he || CONSENT_HE;
}

/**
 * What is not configured, in the words of what a recipient would notice.
 * Printed at startup: none of this is visible from the server otherwise.
 */
export function templateWarnings() {
  const warnings = [];

  if (!DELIVERY_HE) {
    warnings.push(
      'META_DELIVERY_TEMPLATE_NAME is not set, so scheduled messages go out through ' +
      `"${CONSENT_HE.name}". Its wording asks the recipient to reply to receive a ` +
      'message it has already shown them.'
    );
  }
  if (!CONSENT_EN) {
    warnings.push(
      'META_TEMPLATE_NAME_EN is not set, so a recipient outside Israel is asked for ' +
      'consent in Hebrew.'
    );
  }
  if (DELIVERY_HE && !DELIVERY_EN) {
    warnings.push(
      'META_DELIVERY_TEMPLATE_NAME_EN is not set, so a recipient outside Israel ' +
      'receives their message wrapped in Hebrew.'
    );
  }

  return warnings;
}
