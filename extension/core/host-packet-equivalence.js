// The same bounded representation equivalence governs machine evidence and
// operator-supplied raw text. This is NOT proof of where supplied text came from.
export const HOST_PACKET_EQUIVALENCE = 'host_packet_crlf_carrier_quotes_v1';
export const HOST_PACKET_EQUIVALENCE_NOTICE = 'Only CRLF/LF line endings and straight/curly quotes delimiting the carrier ID in <ext_ctx id="dgce-…"> may differ. All other differences—including body punctuation, spaces, story text and tags—block confirmation.';

function normalized(text) {
  const transformations = [];
  const lf = text.replace(/\r\n/g, (before, offset) => {
    transformations.push({ stage: 'line_endings', offset, before, after: '\n' });
    return '\n';
  });
  const value = lf.replace(/(<ext_ctx id=)[\u201c\u201d"](dgce-[0-9a-f]{6,})[\u201c\u201d"]>/g,
    (before, prefix, nonce, offset) => {
      const after = `${prefix}"${nonce}">`;
      if (before !== after) transformations.push({ stage: 'carrier_id_quotes', offset, before, after });
      return after;
    });
  return { value, transformations };
}

export const normalizeHostPacket = text => normalized(String(text)).value;

export function compareHostPackets(expected, inspected) {
  if (typeof expected !== 'string' || typeof inspected !== 'string') {
    return { policy: HOST_PACKET_EQUIVALENCE, status: 'unavailable', equivalent: false };
  }
  const left = normalized(expected), right = normalized(inspected);
  const equivalent = left.value === right.value;
  let difference = null;
  if (!equivalent) {
    let offset = 0;
    while (offset < Math.min(left.value.length, right.value.length) && left.value[offset] === right.value[offset]) offset++;
    difference = { offset, expected: left.value.slice(offset, offset + 120), inspected: right.value.slice(offset, offset + 120),
      expected_length: left.value.length, inspected_length: right.value.length };
  }
  return { policy: HOST_PACKET_EQUIVALENCE, equivalent,
    status: expected === inspected ? 'exact' : equivalent ? 'normalized_equivalent' : 'mismatch',
    expected_transformations: left.transformations, inspected_transformations: right.transformations,
    first_normalized_difference: difference };
}
