import { render } from '@testing-library/react-native';
import { Text } from './text.js';

describe('Text (Native)', () => {
  it('variant display (700) gán fontFamily BeVietnamPro_700Bold', async () => {
    const { getByText } = await render(<Text variant="display">Tiêu đề lớn</Text>);

    const element = getByText('Tiêu đề lớn');
    expect(element.props.style).toEqual(
      expect.objectContaining({
        fontFamily: 'BeVietnamPro_700Bold',
      }),
    );
  });

  it('variant headline-md (600) gán fontFamily BeVietnamPro_600SemiBold', async () => {
    const { getByText } = await render(<Text variant="headline-md">Tiêu đề vừa</Text>);

    const element = getByText('Tiêu đề vừa');
    expect(element.props.style).toEqual(
      expect.objectContaining({
        fontFamily: 'BeVietnamPro_600SemiBold',
      }),
    );
  });

  it('variant label-md (500) gán fontFamily BeVietnamPro_500Medium', async () => {
    const { getByText } = await render(<Text variant="label-md">Nhãn</Text>);

    const element = getByText('Nhãn');
    expect(element.props.style).toEqual(
      expect.objectContaining({
        fontFamily: 'BeVietnamPro_500Medium',
      }),
    );
  });

  it('variant body-md (400) gán fontFamily Be Vietnam Pro', async () => {
    const { getByText } = await render(<Text variant="body-md">Nội dung</Text>);

    const element = getByText('Nội dung');
    expect(element.props.style).toEqual(
      expect.objectContaining({
        fontFamily: 'Be Vietnam Pro',
      }),
    );
  });
});
