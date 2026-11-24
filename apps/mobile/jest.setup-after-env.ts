import { configure } from '@testing-library/react-native';

// Test đầu mỗi file chạy khi module chưa nạp xong (máy chậm / nhiều worker) → 1 giây mặc định của `waitFor` không đủ.
configure({ asyncUtilTimeout: 4000 });
