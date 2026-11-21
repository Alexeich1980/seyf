// Only ASCII digits with whitespace separators are a numeric card number.
// Never interpret legacy text, punctuation or barcode payloads as numbers.
const numeric = value => /^\s*[0-9][0-9\s]*$/.test(value);
export function normalizeLoyaltyNumber(value) {
  const text = String(value ?? '');
  return numeric(text) ? text.replace(/\s/g, '') : text;
}
export function formatLoyaltyNumber(value) {
  const text = normalizeLoyaltyNumber(value);
  return /^[0-9]+$/.test(text) ? text.match(/.{1,4}/g).join(' ') : text;
}

export function bindLoyaltyNumber(input) {
  input.type = 'text'; input.inputMode = 'numeric';
  input.value = formatLoyaltyNumber(input.value);
  const format = () => {
    const text = input.value;
    if (!numeric(text)) return;
    const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
    const position = offset => {
      const digits = text.slice(0, offset).replace(/\s/g, '').length;
      return digits + Math.floor(Math.max(0, digits - 1) / 4);
    };
    const formatted = formatLoyaltyNumber(text);
    if (formatted === text) return;
    input.value = formatted;
    input.setSelectionRange(position(start), position(end), direction);
  };
  // Let the browser perform the deletion (and keep its editing history), but
  // include the neighbouring digit when the caret touches a generated space.
  input.addEventListener('beforeinput', event => {
    if (event.isComposing || !numeric(input.value) || input.selectionStart !== input.selectionEnd) return;
    const at = input.selectionStart;
    if (event.inputType === 'deleteContentBackward' && input.value[at - 1] === ' ') {
      input.setSelectionRange(Math.max(0, at - 2), at);
    } else if (event.inputType === 'deleteContentForward' && input.value[at] === ' ') {
      input.setSelectionRange(at, at + 2);
    }
  });
  input.addEventListener('input', event => { if (!event.isComposing) format(); });
  input.addEventListener('compositionend', format);
}
