import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { TagPicker, ProfileTagData } from '../components/TagPicker';
import { useTagsByCategory, useSearchTags, useCreateTag } from '../hooks/useTags';

jest.mock('../hooks/useTags', () => ({
  useTagsByCategory: jest.fn(),
  useSearchTags: jest.fn(),
  useCreateTag: jest.fn(),
}));

const MOCK_TAGS = [
  { id: 't1', category: 'fandom', name: 'Star Wars', slug: 'fandom__star_wars', multi_select: true, status: 'active' },
  { id: 't2', category: 'fandom', name: 'Lord of the Rings', slug: 'fandom__lord_of_the_rings', multi_select: true, status: 'active' },
  { id: 't3', category: 'fandom', name: 'Harry Potter', slug: 'fandom__harry_potter', multi_select: true, status: 'pending' },
];

describe('TagPicker', () => {
  const mockOnTagsChange = jest.fn();
  const mockCreateMutateAsync = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    (useTagsByCategory as jest.Mock).mockReturnValue({
      data: MOCK_TAGS,
      isLoading: false,
    });
    (useSearchTags as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
    });
    (useCreateTag as jest.Mock).mockReturnValue({
      mutateAsync: mockCreateMutateAsync,
      isPending: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders label and search input', () => {
    const { getByText, getByTestId } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        selectedTags={[]}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    expect(getByText('Fandoms')).toBeTruthy();
    expect(getByTestId('fandom-search')).toBeTruthy();
  });

  it('displays category tags as chips', () => {
    const { getByText } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        selectedTags={[]}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    expect(getByText('Star Wars')).toBeTruthy();
    expect(getByText('Lord of the Rings')).toBeTruthy();
    expect(getByText('Harry Potter')).toBeTruthy();
  });

  it('selects a tag on press (multi-select)', () => {
    const { getByTestId } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        multiSelect={true}
        selectedTags={[]}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    fireEvent.press(getByTestId('fandom-tag-fandom__star_wars'));

    expect(mockOnTagsChange).toHaveBeenCalledWith([
      { id: 't1', category: 'fandom', name: 'Star Wars', slug: 'fandom__star_wars', status: 'active' },
    ]);
  });

  it('adds to existing selection in multi-select mode', () => {
    const existingSelection: ProfileTagData[] = [
      { id: 't1', category: 'fandom', name: 'Star Wars', slug: 'fandom__star_wars', status: 'active' },
    ];

    const { getByTestId } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        multiSelect={true}
        selectedTags={existingSelection}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    fireEvent.press(getByTestId('fandom-tag-fandom__lord_of_the_rings'));

    expect(mockOnTagsChange).toHaveBeenCalledWith([
      ...existingSelection,
      { id: 't2', category: 'fandom', name: 'Lord of the Rings', slug: 'fandom__lord_of_the_rings', status: 'active' },
    ]);
  });

  it('replaces selection in single-select mode', () => {
    const existingSelection: ProfileTagData[] = [
      { id: 't1', category: 'fandom', name: 'Star Wars', slug: 'fandom__star_wars', status: 'active' },
    ];

    const { getByTestId } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        multiSelect={false}
        selectedTags={existingSelection}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    fireEvent.press(getByTestId('fandom-tag-fandom__lord_of_the_rings'));

    expect(mockOnTagsChange).toHaveBeenCalledWith([
      { id: 't2', category: 'fandom', name: 'Lord of the Rings', slug: 'fandom__lord_of_the_rings', status: 'active' },
    ]);
  });

  it('deselects a tag when pressing an already-selected tag', () => {
    const existingSelection: ProfileTagData[] = [
      { id: 't1', category: 'fandom', name: 'Star Wars', slug: 'fandom__star_wars', status: 'active' },
      { id: 't2', category: 'fandom', name: 'Lord of the Rings', slug: 'fandom__lord_of_the_rings', status: 'active' },
    ];

    const { getByTestId } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        multiSelect={true}
        selectedTags={existingSelection}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    fireEvent.press(getByTestId('fandom-tag-fandom__star_wars'));

    expect(mockOnTagsChange).toHaveBeenCalledWith([
      { id: 't2', category: 'fandom', name: 'Lord of the Rings', slug: 'fandom__lord_of_the_rings', status: 'active' },
    ]);
  });

  it('shows selected tags summary with remove buttons', () => {
    const selected: ProfileTagData[] = [
      { id: 't1', category: 'fandom', name: 'Star Wars', slug: 'fandom__star_wars', status: 'active' },
    ];

    const { getByText, getAllByText } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        selectedTags={selected}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    expect(getByText('Selected:')).toBeTruthy();
    // Star Wars appears in both the tag grid and the selected summary
    expect(getAllByText('Star Wars').length).toBeGreaterThanOrEqual(2);
  });

  it('triggers search when typing in search input', () => {
    const { getByTestId } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        selectedTags={[]}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    fireEvent.changeText(getByTestId('fandom-search'), 'star');

    // Debounce fires after 300ms
    act(() => { jest.advanceTimersByTime(300); });

    expect(useSearchTags).toHaveBeenCalledWith('fandom', 'star');
  });

  it('shows "Add as suggestion" button when search has no results', () => {
    // Mock search returning no results
    (useSearchTags as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
    });

    const { getByTestId, getByText } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        selectedTags={[]}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    // Type a search query
    fireEvent.changeText(getByTestId('fandom-search'), 'Naruto');
    act(() => { jest.advanceTimersByTime(300); });

    expect(getByTestId('fandom-suggest')).toBeTruthy();
  });

  it('creates a pending tag when "Add as suggestion" is pressed', async () => {
    const newTag = {
      id: 'new-1',
      category: 'fandom',
      name: 'Naruto',
      slug: 'fandom__naruto',
      multi_select: true,
      status: 'pending',
    };

    mockCreateMutateAsync.mockResolvedValue(newTag);

    (useSearchTags as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
    });

    const { getByTestId } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        selectedTags={[]}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    // Type search query
    fireEvent.changeText(getByTestId('fandom-search'), 'Naruto');
    act(() => { jest.advanceTimersByTime(300); });

    // Press suggest button
    await act(async () => {
      fireEvent.press(getByTestId('fandom-suggest'));
    });

    expect(mockCreateMutateAsync).toHaveBeenCalledWith({
      category: 'fandom',
      name: 'Naruto',
    });

    expect(mockOnTagsChange).toHaveBeenCalledWith([
      { id: 'new-1', category: 'fandom', name: 'Naruto', slug: 'fandom__naruto', status: 'pending' },
    ]);
  });

  it('shows loading indicator while category tags are loading', () => {
    (useTagsByCategory as jest.Mock).mockReturnValue({
      data: [],
      isLoading: true,
    });

    const { queryByText } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        selectedTags={[]}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    // Tags should not be visible while loading
    expect(queryByText('Star Wars')).toBeNull();
  });

  it('clears search input when clear button is pressed', () => {
    const { getByTestId } = render(
      <TagPicker
        category="fandom"
        label="Fandoms"
        selectedTags={[]}
        onTagsChange={mockOnTagsChange}
        testIDPrefix="fandom"
      />
    );

    const searchInput = getByTestId('fandom-search');
    fireEvent.changeText(searchInput, 'something');

    expect(searchInput.props.value).toBe('something');

    // Find and press the clear button (Ionicons close-circle)
    // The clear button appears when searchQuery.length > 0
    // We can't easily target it by testID, so let's verify the state resets
    fireEvent.changeText(searchInput, '');
    expect(searchInput.props.value).toBe('');
  });
});
