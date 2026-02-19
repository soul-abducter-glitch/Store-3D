type ZipEntry = {
  name: string;
  data: Uint8Array;
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (date: Date) => {
  const year = Math.max(1980, date.getUTCFullYear());
  const month = Math.max(1, Math.min(12, date.getUTCMonth() + 1));
  const day = Math.max(1, Math.min(31, date.getUTCDate()));
  const hours = Math.max(0, Math.min(23, date.getUTCHours()));
  const minutes = Math.max(0, Math.min(59, date.getUTCMinutes()));
  const seconds = Math.max(0, Math.min(59, date.getUTCSeconds()));
  const dosTime = (hours << 11) | (minutes << 5) | Math.floor(seconds / 2);
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosDate, dosTime };
};

const toUtf8 = (value: string) => Buffer.from(value, "utf8");

const u16 = (value: number) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
};

const u32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
};

export const buildStoredZip = (entries: ZipEntry[]) => {
  const now = new Date();
  const { dosDate, dosTime } = dosDateTime(now);
  const files = entries.filter((entry) => entry.name && entry.data);

  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  files.forEach((entry) => {
    const nameBytes = toUtf8(entry.name);
    const dataBytes = Buffer.from(entry.data);
    const checksum = crc32(dataBytes);

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(checksum),
      u32(dataBytes.length),
      u32(dataBytes.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    localChunks.push(localHeader, dataBytes);

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(checksum),
      u32(dataBytes.length),
      u32(dataBytes.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    centralChunks.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  });

  const centralDirectory = Buffer.concat(centralChunks);
  const localData = Buffer.concat(localChunks);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDirectory.length),
    u32(localData.length),
    u16(0),
  ]);

  return Buffer.concat([localData, centralDirectory, end]);
};
