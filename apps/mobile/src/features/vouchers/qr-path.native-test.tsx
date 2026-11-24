import qrcode from 'qrcode-generator';
import { qrPath } from './qr-path.js';

describe('qrPath', () => {
  it('tạo size và d hợp lệ, số ô đen khớp isDark', () => {
    const text = 'https://tamgiao.vn/voucher/01890a5d-ac96-774b-bcce-b302099a8057';
    const result = qrPath(text);

    // Đối chiếu với qrcode-generator gốc
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();

    const moduleCount = qr.getModuleCount();
    // Viền trắng 4 ô mỗi phía
    expect(result.size).toBe(moduleCount + 8);

    // Chuỗi d hợp lệ
    expect(result.d.startsWith('M')).toBe(true);
    expect(result.d.endsWith('z')).toBe(true);

    // Đếm số ô đen thực tế từ qr.isDark
    let darkModulesCount = 0;
    for (let r = 0; r < moduleCount; r += 1) {
      for (let c = 0; c < moduleCount; c += 1) {
        if (qr.isDark(r, c)) {
          darkModulesCount += 1;
        }
      }
    }

    // Đếm tổng số ô đen được vẽ trong path SVG
    // Mỗi đoạn ô đen liên tiếp có dạng M{x} {y}h{n}v1h-{n}z
    const matches = result.d.matchAll(/h(\d+)v1h-\1z/g);
    let pathDarkCount = 0;
    for (const match of matches) {
      const lengthStr = match[1];
      if (lengthStr !== undefined) {
        pathDarkCount += Number(lengthStr);
      }
    }

    expect(pathDarkCount).toBe(darkModulesCount);
    expect(darkModulesCount).toBeGreaterThan(0);
  });

  it('xử lý chuỗi ngắn và toạ độ cộng đúng viền 4 ô', () => {
    const result = qrPath('A');
    const qr = qrcode(0, 'M');
    qr.addData('A');
    qr.make();

    expect(result.size).toBe(qr.getModuleCount() + 8);

    // Kiểm tra toạ độ đầu tiên có x >= 4 và y >= 4 (vì viền là 4)
    const firstMoveMatch = /^M(\d+)\s+(\d+)/.exec(result.d);
    expect(firstMoveMatch).not.toBeNull();
    if (firstMoveMatch !== null) {
      const firstX = Number(firstMoveMatch[1]);
      const firstY = Number(firstMoveMatch[2]);
      expect(firstX).toBeGreaterThanOrEqual(4);
      expect(firstY).toBeGreaterThanOrEqual(4);
    }
  });
});
