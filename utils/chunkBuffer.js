function createChunkBuffer(size) {
  let buffer = Buffer.allocUnsafe(size);
  let offset = 0;

  return {
    push(data) {
      const chunks = [];
      let cursor = 0;

      while (cursor < data.length) {
        const remaining = size - offset;
        const take = Math.min(
          remaining,
          data.length - cursor
        );

        data.copy(
          buffer,
          offset,
          cursor,
          cursor + take
        );

        offset += take;
        cursor += take;

        if (offset === size) {
          chunks.push(buffer);

          buffer = Buffer.allocUnsafe(size);
          offset = 0;
        }
      }

      return chunks;
    },

    flush() {
      if (offset === 0) {
        return null;
      }

      return buffer.subarray(0, offset);
    }
  };
}

module.exports = {
  createChunkBuffer
};