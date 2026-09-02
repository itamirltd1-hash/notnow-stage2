import axios from 'axios';

/**
 * Bring a phone number from PENDING to CONNECTED.
 *
 * A number added in Business Manager is not yet usable: the Cloud API has to
 * claim it, which happens over three calls Meta does not expose in the UI.
 * This lives as a script rather than an HTTP route because an endpoint that
 * can re-register the sending number is not something to leave reachable.
 *
 *   npm run phone status
 *   npm run phone request-code
 *   npm run phone verify 123456
 *   npm run phone register 447722
 *   npm run phone send +972501234567
 */
const GRAPH = 'https://graph.facebook.com/v18.0';
const token = process.env.META_API_TOKEN;
const phoneId = process.env.META_PHONE_NUMBER_ID;

const [command, argument] = process.argv.slice(2);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function reportError(error) {
  const err = error.response?.data?.error;
  console.error(`❌ ${err?.message || error.message}`);
  // Meta scatters the useful part across several fields; print whatever came.
  for (const [label, value] of [
    ['details', err?.error_data?.details],
    ['user title', err?.error_user_title],
    ['user message', err?.error_user_msg],
    ['code', err?.code],
    ['subcode', err?.error_subcode],
    ['type', err?.type]
  ]) {
    if (value !== undefined && value !== null) console.error(`   ${label}: ${value}`);
  }
  process.exit(1);
}

// The rest of the service authenticates with a bearer header and Meta accepts
// it; passing the token as a query parameter alongside a JSON body does not
// reliably work on every endpoint.
const auth = { headers: { Authorization: `Bearer ${token}` } };

if (!token || !phoneId) fail('META_API_TOKEN and META_PHONE_NUMBER_ID must be set');

async function status() {
  const { data } = await axios.get(`${GRAPH}/${phoneId}`, {
    ...auth,
    params: {
      fields: 'display_phone_number,verified_name,status,code_verification_status,quality_rating,platform_type'
    }
  });
  console.log(JSON.stringify(data, null, 2));

  if (data.status === 'CONNECTED') {
    console.log('\n✅ Ready to send.');
  } else {
    console.log(`\n⏳ Status is ${data.status}. Registration is not finished.`);
  }
}

async function requestCode() {
  await axios.post(`${GRAPH}/${phoneId}/request_code`, null, {
    ...auth,
    params: { code_method: 'SMS', language: 'he' }
  });
  console.log('✅ Code requested. It arrives by SMS at the number itself.');
  console.log('   Then run:  npm run phone verify 123456');
}

async function verify(code) {
  if (!code) fail('Pass the 6-digit code:  npm run phone verify 123456');
  await axios.post(`${GRAPH}/${phoneId}/verify_code`, null, {
    ...auth,
    params: { code }
  });
  console.log('✅ Code accepted.');
  console.log('   Then run:  npm run phone register 447722   (choose any 6 digits)');
}

async function register(pin) {
  if (!/^\d{6}$/.test(pin || '')) {
    fail('Pass a 6-digit PIN of your choosing:  npm run phone register 447722\n' +
         '   Write it down — Meta asks for it if this number is ever re-registered.');
  }
  await axios.post(`${GRAPH}/${phoneId}/register`, {
    messaging_product: 'whatsapp',
    pin: String(pin)
  }, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  console.log('✅ Registered. Checking status...\n');
  await status();
}

/**
 * Send one template message, to prove the whole path works.
 *
 * A newly registered number is invisible to a phone that cached "not on
 * WhatsApp" from before it was registered, and no amount of waiting on that
 * phone clears it reliably. A message from the business side opens the chat
 * and settles it — and on the way it exercises the token, the phone number id,
 * the template name and its language, which is every setting that has to be
 * right before a real message goes out.
 *
 * A template rather than free text: nobody has written to this number yet, so
 * the 24-hour window is closed and free text would be rejected.
 */
async function send(recipient) {
  if (!/^\+?\d{9,15}$/.test((recipient || '').replace(/[\s\-()]/g, ''))) {
    fail('Pass the number to write to:  npm run phone send +972501234567');
  }

  const name = process.env.META_TEMPLATE_NAME || 'scheduled_message_reminder';
  const language = process.env.META_TEMPLATE_LANGUAGE || 'he';
  const to = recipient.replace(/[\s\-()+]/g, '');

  console.log(`📄 Sending template "${name}" (${language}) to ${to}`);

  const { data } = await axios.post(`${GRAPH}/${phoneId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name,
      language: { code: language },
      components: [{
        type: 'body',
        // Two slots, whichever job this template's wording serves.
        parameters: [
          { type: 'text', text: 'בדיקה' },
          { type: 'text', text: 'Cue' }
        ]
      }]
    }
  }, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });

  console.log(`✅ Sent. Message id: ${data.messages?.[0]?.id}`);
  console.log('   If it does not arrive, the number is right and something else is wrong —');
  console.log('   check the Deploy Logs for a delivery status webhook.');
}

const commands = { status, 'request-code': requestCode, verify, register, send };

if (!commands[command]) {
  console.log('Usage:\n' +
    '  npm run phone status\n' +
    '  npm run phone request-code\n' +
    '  npm run phone verify <6-digit code from SMS>\n' +
    '  npm run phone register <6-digit PIN you choose>\n' +
    '  npm run phone send <number> — one template message, to prove it works');
  process.exit(1);
}

commands[command](argument).catch(reportError);
