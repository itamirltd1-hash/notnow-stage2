import axios from 'axios';
import FormData from 'form-data';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MODEL = process.env.WHISPER_MODEL || 'whisper-1';

/**
 * Is transcription configured at all?
 * Checked before downloading anything, so a missing key costs one clear
 * message rather than a failed download and a stack trace.
 */
export function isTranscriptionAvailable() {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && !key.startsWith('your_'));
}

/**
 * Transcribe a voice note.
 *
 * WhatsApp sends voice notes as OGG/Opus, which Whisper accepts directly, so
 * no re-encoding step is needed. The language hint measurably improves Hebrew
 * accuracy and stops short clips being detected as Arabic or Yiddish.
 */
export async function transcribeAudio(buffer, mimeType = 'audio/ogg', language = 'he') {
  if (!isTranscriptionAvailable()) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const extension = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a'
    : mimeType.includes('mpeg') ? 'mp3'
    : 'ogg';

  const form = new FormData();
  form.append('file', buffer, { filename: `voice.${extension}`, contentType: mimeType });
  form.append('model', MODEL);
  form.append('language', language);

  console.log(`🎙️  Transcribing ${buffer.length} bytes (${mimeType}) as ${language}`);

  try {
    const response = await axios.post(WHISPER_URL, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      timeout: 60000,
      maxBodyLength: Infinity
    });

    const text = (response.data.text || '').trim();
    console.log(`   → "${text}"`);
    return text;
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.error('❌ Transcription failed:', detail);
    throw new Error(`Transcription failed: ${detail}`);
  }
}
