/**
 * The one place the product's name is written.
 *
 * It used to sit inline in four separate strings, which is how a rename
 * misses one and a customer finds it. The approved WhatsApp template carries
 * this name too, so any change here means re-submitting that template — check
 * META_TEMPLATE_NAME's body before editing.
 */
export const BRAND = process.env.BRAND_NAME || 'Cue';
