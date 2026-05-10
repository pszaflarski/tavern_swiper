import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Colors, Fonts, Spacing, Radius } from '../theme';
import { useTagsByCategory, useSearchTags, useCreateTag, TagData } from '../hooks/useTags';
import { Ionicons } from '@expo/vector-icons';
import { styles } from './TagPicker.styles';

export interface ProfileTagData {
  id: string;
  category: string;
  name: string;
  slug: string;
  status: string;
}

interface TagPickerProps {
  category: string;
  label: string;
  multiSelect?: boolean;
  selectedTags: ProfileTagData[];
  onTagsChange: (tags: ProfileTagData[]) => void;
  testIDPrefix?: string;
}

function tagToProfileTag(tag: TagData): ProfileTagData {
  return {
    id: tag.id,
    category: tag.category,
    name: tag.name,
    slug: tag.slug,
    status: tag.status,
  };
}

export function TagPicker({
  category,
  label,
  multiSelect = true,
  selectedTags,
  onTagsChange,
  testIDPrefix,
}: TagPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Debounce the search query
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch tags for this category (shown as defaults)
  const { data: categoryTags = [], isLoading: isLoadingCategory } = useTagsByCategory(category);
  
  // Search results (only when actively searching)
  const { data: searchResults = [], isLoading: isLoadingSearch } = useSearchTags(category, debouncedQuery);

  // Create tag mutation
  const createTag = useCreateTag();

  const selectedIds = useMemo(() => new Set(selectedTags.map(t => t.id)), [selectedTags]);

  // Keep a ref to selectedTags so toggleTag always reads the latest value,
  // preventing stale-closure issues when taps arrive in quick succession.
  const selectedTagsRef = useRef(selectedTags);
  selectedTagsRef.current = selectedTags;

  const toggleTag = useCallback((tag: TagData) => {
    const current = selectedTagsRef.current;
    const currentIds = new Set(current.map(t => t.id));
    if (currentIds.has(tag.id)) {
      // Deselect
      onTagsChange(current.filter(t => t.id !== tag.id));
    } else if (multiSelect) {
      // Add
      onTagsChange([...current, tagToProfileTag(tag)]);
    } else {
      // Replace (single select)
      onTagsChange([tagToProfileTag(tag)]);
    }
  }, [multiSelect, onTagsChange]);

  const handleCreateTag = useCallback(async () => {
    if (!searchQuery.trim()) return;
    try {
      const newTag = await createTag.mutateAsync({ category, name: searchQuery.trim() });
      // Auto-select the newly created tag — read from ref to avoid stale closure
      const current = selectedTagsRef.current;
      if (multiSelect) {
        onTagsChange([...current, tagToProfileTag(newTag)]);
      } else {
        onTagsChange([tagToProfileTag(newTag)]);
      }
      setSearchQuery('');
      setIsSearching(false);
    } catch (e) {
      console.error('Failed to create tag:', e);
    }
  }, [searchQuery, category, multiSelect, onTagsChange, createTag]);

  // Determine which tags to display
  const displayTags = debouncedQuery.length >= 2 ? searchResults : categoryTags;
  const isLoading = debouncedQuery.length >= 2 ? isLoadingSearch : isLoadingCategory;

  // Show the suggest button when the user's exact query doesn't already exist as a tag,
  // even if partial matches are displayed. Check both search results and category tags.
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const exactMatchExists = useMemo(() => {
    const allKnown = debouncedQuery.length >= 2 ? searchResults : categoryTags;
    return allKnown.some(t => t.name.toLowerCase() === trimmedQuery);
  }, [debouncedQuery, searchResults, categoryTags, trimmedQuery]);
  const canSuggest = debouncedQuery.length >= 2 && !isLoadingSearch && trimmedQuery.length > 0 && !exactMatchExists;

  const renderTag = useCallback(({ item }: { item: TagData }) => {
    const isSelected = selectedIds.has(item.id);
    const isPending = item.status === 'pending';
    return (
      <TouchableOpacity
        key={item.id}
        testID={testIDPrefix ? `${testIDPrefix}-tag-${item.slug}` : undefined}
        style={[
          styles.tagChip,
          isSelected && styles.tagChipSelected,
          isPending && !isSelected && styles.tagChipPending,
        ]}
        onPress={() => toggleTag(item)}
        activeOpacity={0.7}
      >
        <Text style={[
          styles.tagChipText,
          isSelected && styles.tagChipTextSelected,
        ]}>
          {item.name}
        </Text>
        {isPending && (
          <Ionicons
            name="time-outline"
            size={12}
            color={isSelected ? Colors.onPrimary : Colors.tertiary}
            style={{ marginLeft: 4 }}
          />
        )}
        {isSelected && (
          <Ionicons
            name="checkmark-circle"
            size={14}
            color={Colors.onPrimary}
            style={{ marginLeft: 4 }}
          />
        )}
      </TouchableOpacity>
    );
  }, [selectedIds, toggleTag, testIDPrefix]);

  return (
    <View style={styles.container} testID={testIDPrefix ? `${testIDPrefix}-picker` : undefined}>
      <Text style={styles.label}>{label}</Text>

      {/* Search Input */}
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={16} color={Colors.outline} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              if (text.length > 0) setIsSearching(true);
              else setIsSearching(false);
            }}
            placeholder={`Search ${label.toLowerCase()}...`}
            placeholderTextColor={Colors.surfaceVariant}
            testID={testIDPrefix ? `${testIDPrefix}-search` : undefined}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => { setSearchQuery(''); setIsSearching(false); }}
              style={styles.clearButton}
            >
              <Ionicons name="close-circle" size={16} color={Colors.outline} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tag Chips */}
      {isLoading ? (
        <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: Spacing[3] }} />
      ) : (
        <View style={styles.tagGrid}>
          {displayTags.map((item) => renderTag({ item }))}
        </View>
      )}

      {/* "Add as suggestion" button */}
      {canSuggest && (
        <TouchableOpacity
          style={styles.suggestButton}
          onPress={handleCreateTag}
          disabled={createTag.isPending}
          testID={testIDPrefix ? `${testIDPrefix}-suggest` : undefined}
        >
          {createTag.isPending ? (
            <ActivityIndicator size="small" color={Colors.tertiary} />
          ) : (
            <>
              <Ionicons name="add-circle-outline" size={18} color={Colors.tertiary} />
              <Text style={styles.suggestText}>
                Add "{searchQuery.trim()}" as {category}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* Selected Tags Summary */}
      {selectedTags.length > 0 && (
        <View style={styles.selectedSummary}>
          <Text style={styles.selectedLabel}>Selected:</Text>
          <View style={styles.selectedChips}>
            {selectedTags.map((tag) => (
              <View key={tag.id} style={styles.selectedChip}>
                <Text style={styles.selectedChipText}>{tag.name}</Text>
                <TouchableOpacity
                  onPress={() => onTagsChange(selectedTags.filter(t => t.id !== tag.id))}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={14} color={Colors.onPrimaryContainer} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

