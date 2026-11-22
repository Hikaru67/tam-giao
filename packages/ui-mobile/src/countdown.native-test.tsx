import { act, render } from '@testing-library/react-native';
import { Countdown } from './countdown.js';

describe('Countdown (Native)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('hiển thị đếm ngược giảm dần và gọi onExpire khi hết giờ', async () => {
    const baseTime = new Date('2026-11-22T10:00:00Z');
    jest.setSystemTime(baseTime);

    const expiresAt = new Date('2026-11-22T10:00:02Z');
    const onExpire = jest.fn();

    const { getByText } = await render(<Countdown expiresAt={expiresAt} onExpire={onExpire} />);

    expect(getByText('00:02')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(getByText('00:01')).toBeTruthy();
    expect(onExpire).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(getByText('00:00')).toBeTruthy();
    expect(onExpire).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
