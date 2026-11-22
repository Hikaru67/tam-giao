import { render } from '@testing-library/react-native';
import { HomeScreen } from './home-screen';

describe('HomeScreen', () => {
  // @testing-library/react-native 14: `render` trả Promise.
  it('hiển thị chữ Tâm Giao', async () => {
    const { getByText } = await render(<HomeScreen />);
    expect(getByText('Tâm Giao')).toBeTruthy();
  });
});
