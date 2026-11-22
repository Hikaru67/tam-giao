import { fireEvent, render } from '@testing-library/react-native';
import { OtpInput } from './otp-input.js';

describe('OtpInput (Native)', () => {
  it('nhập 6 số kích hoạt onComplete đúng 1 lần', async () => {
    const onComplete = jest.fn();
    const { getByLabelText } = await render(<OtpInput onComplete={onComplete} accessibilityLabel="Mã OTP" />);

    const input = getByLabelText('Mã OTP');

    await fireEvent.changeText(input, '12345');
    expect(onComplete).not.toHaveBeenCalled();

    await fireEvent.changeText(input, '123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');

    // Nhập lại cùng chuỗi không gọi lại onComplete
    await fireEvent.changeText(input, '123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
