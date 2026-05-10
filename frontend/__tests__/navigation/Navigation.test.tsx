import React from 'react';
import { render } from '@testing-library/react-native';
import TabLayout from '../../app/(tabs)/_layout';

// Mock Tabs from expo-router to verify they render with correct IDs
jest.mock('expo-router', () => ({
  Tabs: Object.assign(
    ({ children }: any) => <>{children}</>,
    {
      Screen: ({ name, options }: any) => {
        const { View, Text } = require('react-native');
        return (
          <View testID={options.tabBarButtonTestID}>
            <Text testID={`${options.tabBarButtonTestID}-label`}>{name}</Text>
          </View>
        );
      },
    }
  ),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSegments: () => [],
}));

describe('Tab Navigation Bar', () => {
  it('renders all tab buttons with correct test IDs and target routes', () => {
    const { getByTestId, getByText } = render(<TabLayout />);
    
    // Verify tavern tab routes to index
    expect(getByTestId('tab-bar-tavern')).toBeTruthy();
    expect(getByTestId('tab-bar-tavern-label').props.children).toBe('index');

    // Verify profiles tab routes to profiles
    expect(getByTestId('tab-bar-profiles')).toBeTruthy();
    expect(getByTestId('tab-bar-profiles-label').props.children).toBe('profiles');

    // Verify messages tab routes to messages
    expect(getByTestId('tab-bar-messages')).toBeTruthy();
    expect(getByTestId('tab-bar-messages-label').props.children).toBe('messages');

    // Verify account tab routes to account
    expect(getByTestId('tab-bar-account')).toBeTruthy();
    expect(getByTestId('tab-bar-account-label').props.children).toBe('account');
  });
});
