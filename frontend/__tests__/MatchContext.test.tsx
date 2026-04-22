import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { View, Text, TouchableOpacity } from 'react-native';
import { MatchProvider, useMatch } from '../context/MatchContext';

// A test harness component that exposes MatchContext state to assertions
function MatchTestHarness() {
  const { showMatch, hideMatch, clearMatchedProfile, isMatchVisible, matchedProfile } = useMatch();

  return (
    <View>
      <Text testID="visibility">{isMatchVisible ? 'visible' : 'hidden'}</Text>
      <Text testID="profile-name">{matchedProfile?.display_name || 'none'}</Text>
      <TouchableOpacity
        testID="show-match"
        onPress={() => showMatch({
          profile_id: 'mp1',
          display_name: 'Valerius the Bold',
          image_url: 'https://example.com/valerius.jpg',
        })}
      />
      <TouchableOpacity testID="hide-match" onPress={hideMatch} />
      <TouchableOpacity testID="clear-profile" onPress={clearMatchedProfile} />
    </View>
  );
}

describe('MatchContext', () => {
  it('throws an error when useMatch is called outside MatchProvider', () => {
    // Suppress React error boundary console noise
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    function Orphan() {
      useMatch();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow('useMatch must be used within a MatchProvider');
    spy.mockRestore();
  });

  it('starts with isMatchVisible=false and matchedProfile=null', () => {
    const { getByTestId } = render(
      <MatchProvider>
        <MatchTestHarness />
      </MatchProvider>
    );

    expect(getByTestId('visibility').props.children).toBe('hidden');
    expect(getByTestId('profile-name').props.children).toBe('none');
  });

  it('showMatch sets the profile and visibility', () => {
    const { getByTestId } = render(
      <MatchProvider>
        <MatchTestHarness />
      </MatchProvider>
    );

    fireEvent.press(getByTestId('show-match'));

    expect(getByTestId('visibility').props.children).toBe('visible');
    expect(getByTestId('profile-name').props.children).toBe('Valerius the Bold');
  });

  it('hideMatch sets visibility to false but preserves the profile', () => {
    const { getByTestId } = render(
      <MatchProvider>
        <MatchTestHarness />
      </MatchProvider>
    );

    // Show then hide
    fireEvent.press(getByTestId('show-match'));
    fireEvent.press(getByTestId('hide-match'));

    expect(getByTestId('visibility').props.children).toBe('hidden');
    // Profile should still be present (for exit animation)
    expect(getByTestId('profile-name').props.children).toBe('Valerius the Bold');
  });

  it('clearMatchedProfile nulls the profile', () => {
    const { getByTestId } = render(
      <MatchProvider>
        <MatchTestHarness />
      </MatchProvider>
    );

    // Show, hide, then clear
    fireEvent.press(getByTestId('show-match'));
    fireEvent.press(getByTestId('hide-match'));
    fireEvent.press(getByTestId('clear-profile'));

    expect(getByTestId('visibility').props.children).toBe('hidden');
    expect(getByTestId('profile-name').props.children).toBe('none');
  });

  it('showMatch can be called again after a full show→hide→clear cycle', () => {
    const { getByTestId } = render(
      <MatchProvider>
        <MatchTestHarness />
      </MatchProvider>
    );

    // First match cycle
    fireEvent.press(getByTestId('show-match'));
    fireEvent.press(getByTestId('hide-match'));
    fireEvent.press(getByTestId('clear-profile'));

    expect(getByTestId('profile-name').props.children).toBe('none');

    // Second match
    fireEvent.press(getByTestId('show-match'));

    expect(getByTestId('visibility').props.children).toBe('visible');
    expect(getByTestId('profile-name').props.children).toBe('Valerius the Bold');
  });
});
