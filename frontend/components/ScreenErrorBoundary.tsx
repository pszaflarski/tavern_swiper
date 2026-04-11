import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Fonts, Spacing, Radius } from '../theme';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
}

export default class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ScreenErrorBoundary caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={styles.title}>Something Went Wrong</Text>
          <Text style={styles.message}>
            {this.props.fallbackMessage || 'An unexpected error occurred. Try again.'}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={this.handleRetry}>
            <Text style={styles.retryText}>TRY AGAIN</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: Spacing[6],
  },
  icon: {
    fontSize: 48,
    marginBottom: Spacing[4],
  },
  title: {
    fontFamily: Fonts.heroic,
    fontSize: 22,
    color: Colors.onSurface,
    marginBottom: Spacing[2],
  },
  message: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    textAlign: 'center',
    marginBottom: Spacing[6],
    lineHeight: 20,
  },
  retryButton: {
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[6],
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  retryText: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.primary,
    letterSpacing: 1,
  },
});
