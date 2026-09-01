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
 * One template does both today. Its body is a delivery — it introduces {{2}}
 * as the message being delivered — so a consent request sent through it is
 * announced as the message it is asking permission to send.
 *
 * Everything defaults to what is approved today, so an unset variable keeps
 * the current behaviour rather than sending into a template that does not
 * exist. Nothing switches to a template until someone says it is approved.
 *
 * The bodies are deliberately not written down here. The last comment that
 * recorded one went stale when the template was edited, and the code went on
 * trusting it. Meta holds the body; this file holds only which name is used
 * for which job.
 */

// The one template known to be approved and active. Its wording delivers a
// message, so that is the job it is the default for.
const DELIVERY_HE = {
  name: process.env.META_TEMPLATE_NAME || 'scheduled_message_reminder',
  language: process.env.META_TEMPLATE_LANGUAGE || 'he',
  carriesTheQuestion: false
};

const DELIVERY_EN = process.env.META_DELIVERY_TEMPLATE_NAME_EN
  ? {
      name: process.env.META_DELIVERY_TEMPLATE_NAME_EN,
      language: process.env.META_DELIVERY_TEMPLATE_LANGUAGE_EN || 'en_US',
      carriesTheQuestion: false
    }
  : null;

// A consent template asks the whole question itself — greeting, who is
// asking, and the two options. Its {{2}} wants a name, not a sentence.
const CONSENT_HE = process.env.META_CONSENT_TEMPLATE_NAME
  ? {
      name: process.env.META_CONSENT_TEMPLATE_NAME,
      language: process.env.META_CONSENT_TEMPLATE_LANGUAGE || 'he',
      carriesTheQuestion: true
    }
  : null;

const CONSENT_EN = process.env.META_CONSENT_TEMPLATE_NAME_EN
  ? {
      name: process.env.META_CONSENT_TEMPLATE_NAME_EN,
      language: process.env.META_CONSENT_TEMPLATE_LANGUAGE_EN || 'en_US',
      carriesTheQuestion: true
    }
  : null;

const TEMPLATES = {
  delivery: { he: DELIVERY_HE, en: DELIVERY_EN },
  consent:  { he: CONSENT_HE,  en: CONSENT_EN }
};

/**
 * The template to use, falling back along the axis that costs least.
 *
 * A recipient reading a Hebrew template they did not expect is a poor
 * experience. A send that fails because the name has no version in the
 * language requested is no experience at all — they receive nothing. So an
 * unconfigured language falls back to Hebrew, and an unconfigured consent
 * template falls back to the delivery one.
 *
 * `carriesTheQuestion` is what the caller needs from that last fallback: a
 * real consent template asks the question in its own body and wants only the
 * sender's name, while the delivery template asks nothing and needs the whole
 * question passed into it. Getting this backwards sends a recipient a bare
 * name where the question should have been.
 */
export function resolveTemplate(job, lang = 'he') {
  const forJob = TEMPLATES[job] || TEMPLATES.delivery;
  return forJob[lang] || forJob.he || DELIVERY_HE;
}

/**
 * What is not configured, in the words of what a recipient would notice.
 * Printed at startup: none of this is visible from the server otherwise.
 */
export function templateWarnings() {
  const warnings = [];

  if (!CONSENT_HE) {
    warnings.push(
      'META_CONSENT_TEMPLATE_NAME is not set, so a consent request goes out through ' +
      `"${DELIVERY_HE.name}", whose body announces the message it is asking permission ` +
      'to send.'
    );
  }
  if (!CONSENT_EN) {
    warnings.push(
      'META_CONSENT_TEMPLATE_NAME_EN is not set, so a recipient outside Israel is ' +
      'asked for consent in Hebrew.'
    );
  }
  if (!DELIVERY_EN) {
    warnings.push(
      'META_DELIVERY_TEMPLATE_NAME_EN is not set, so a recipient outside Israel ' +
      'receives their message wrapped in Hebrew.'
    );
  }

  return warnings;
}
