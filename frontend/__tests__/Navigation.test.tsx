import React from 'react';
import { render } from '@testing-library/react-native';
import TabLayout from '../app/(tabs)/_layout';

// Mock Tabs from expo-router to verify they render with correct IDs
jest.mock('expo-router', () => ({
  Tabs: Object.assign(
    ({ children }: any) => <>{children}</>,
    {
      Screen: ({ options }: any) => {
        const { View } = require('react-native');
        return <View testID={options.tabBarButtonTestID} />;
      },
    }
  ),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

describe('Tab Navigation Bar', () => {
  it('renders all tab buttons with correct test IDs', () => {
    const { getByTestId } = render(<TabLayout />);
    
    expect(getByTestId('tab-bar-tavern')).toBeTruthy();
    expect(getByTestId('tab-bar-profiles')).toBeTruthy();
    expect(getByTestId('tab-bar-account')).toBeTruthy();
  });
});
