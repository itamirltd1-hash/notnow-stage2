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

const commands = { status, 'request-code': requestCode, verify, register };

if (!commands[command]) {
  console.log('Usage:\n' +
    '  npm run phone status\n' +
    '  npm run phone request-code\n' +
    '  npm run phone verify <6-digit code from SMS>\n' +
    '  npm run phone register <6-digit PIN you choose>');
  process.exit(1);
}

commands[command](argument).catch(reportError);
