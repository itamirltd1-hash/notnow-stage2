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
 * One template does both, and which sentence it holds is not something this
 * file can know: the same name exists on several accounts in this project
 * with different bodies, and the account that sends changed underneath it.
 * So the role is declared in the environment, not inferred from the name.
 *
 * Which template a send actually reaches is decided by the WABA behind the
 * phone number ID. A body read on the wrong account describes a template this
 * code never touches — that mistake cost an afternoon and two wrong commits.
 *
 * The bodies are deliberately not written down here. The last comment that
 * recorded one went stale when the template was edited, and the code went on
 * trusting it. Meta holds the body; this file holds only which name is used
 * for which job.
 */

// The one template we know exists on whichever account is sending.
//
// Which job its wording serves is not a property of the name — it changed
// when the sending account changed, and guessing it wrong is expensive in
// both directions: a consent request sent through a delivery template asks
// nothing at all, and a delivered message sent through a consent template
// arrives inside "reply 1 to receive the message". So it is declared, not
// inferred. META_TEMPLATE_ROLE is 'delivery' or 'consent'.
const SHARED_ROLE = process.env.META_TEMPLATE_ROLE === 'consent' ? 'consent' : 'delivery';

const SHARED = {
  name: process.env.META_TEMPLATE_NAME || 'scheduled_message_reminder',
  language: process.env.META_TEMPLATE_LANGUAGE || 'he',
  // A consent template asks the whole question itself and wants only the
  // sender's name in its slot. A delivery template asks nothing, so the
  // question has to be passed into it or the recipient is sent a bare name.
  carriesTheQuestion: SHARED_ROLE === 'consent'
};

function named(nameVar, langVar, fallbackLang, carriesTheQuestion) {
  return process.env[nameVar]
    ? {
        name: process.env[nameVar],
        language: process.env[langVar] || fallbackLang,
        carriesTheQuestion
      }
    : null;
}

const CONSENT_HE = named('META_CONSENT_TEMPLATE_NAME', 'META_CONSENT_TEMPLATE_LANGUAGE', 'he', true)
  || (SHARED_ROLE === 'consent' ? SHARED : null);
const CONSENT_EN = named('META_CONSENT_TEMPLATE_NAME_EN', 'META_CONSENT_TEMPLATE_LANGUAGE_EN', 'en_US', true);

const DELIVERY_HE = named('META_DELIVERY_TEMPLATE_NAME', 'META_DELIVERY_TEMPLATE_LANGUAGE', 'he', false)
  || (SHARED_ROLE === 'delivery' ? SHARED : null);
const DELIVERY_EN = named('META_DELIVERY_TEMPLATE_NAME_EN', 'META_DELIVERY_TEMPLATE_LANGUAGE_EN', 'en_US', false);

// Order matters: the right job first, then the right language, then the one
// template known to exist.
const CHAINS = {
  'delivery|he': [DELIVERY_HE, SHARED],
  'delivery|en': [DELIVERY_EN, DELIVERY_HE, SHARED],
  'consent|he':  [CONSENT_HE, SHARED],
  'consent|en':  [CONSENT_EN, CONSENT_HE, SHARED]
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
  const chain = CHAINS[`${job}|${lang}`] || CHAINS[`${job}|he`] || CHAINS['delivery|he'];
  return chain.find(Boolean) || SHARED;
}

/**
 * What is not configured, in the words of what a recipient would notice.
 * Printed at startup: none of this is visible from the server otherwise.
 */
export function templateWarnings() {
  const warnings = [];

  if (!DELIVERY_HE) {
    warnings.push(
      `META_TEMPLATE_ROLE says "${SHARED_ROLE}" and META_DELIVERY_TEMPLATE_NAME is not set, ` +
      `so a scheduled message goes out through "${SHARED.name}", which asks the recipient ` +
      'to reply 1 to receive the message it has already shown them.'
    );
  }
  if (!CONSENT_HE) {
    warnings.push(
      `META_TEMPLATE_ROLE says "${SHARED_ROLE}" and META_CONSENT_TEMPLATE_NAME is not set, ` +
      `so a consent request goes out through "${SHARED.name}", whose body announces the ` +
      'message it is asking permission to send.'
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
