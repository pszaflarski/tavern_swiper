import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Colors, Fonts, Spacing, Radius } from '../theme';
import { useTagsByCategory, useSearchTags, useCreateTag, TagData } from '../hooks/useTags';
import { Ionicons } from '@expo/vector-icons';

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

  const selectedIds = new Set(selectedTags.map(t => t.id));

  const toggleTag = useCallback((tag: TagData) => {
    if (selectedIds.has(tag.id)) {
      // Deselect
      onTagsChange(selectedTags.filter(t => t.id !== tag.id));
    } else if (multiSelect) {
      // Add
      onTagsChange([...selectedTags, tagToProfileTag(tag)]);
    } else {
      // Replace (single select)
      onTagsChange([tagToProfileTag(tag)]);
    }
  }, [selectedTags, selectedIds, multiSelect, onTagsChange]);

  const handleCreateTag = useCallback(async () => {
    if (!searchQuery.trim()) return;
    try {
      const newTag = await createTag.mutateAsync({ category, name: searchQuery.trim() });
      // Auto-select the newly created tag
      if (multiSelect) {
        onTagsChange([...selectedTags, tagToProfileTag(newTag)]);
      } else {
        onTagsChange([tagToProfileTag(newTag)]);
      }
      setSearchQuery('');
      setIsSearching(false);
    } catch (e) {
      console.error('Failed to create tag:', e);
    }
  }, [searchQuery, category, multiSelect, selectedTags, onTagsChange, createTag]);

  // Determine which tags to display
  const displayTags = debouncedQuery.length >= 2 ? searchResults : categoryTags;
  const isLoading = debouncedQuery.length >= 2 ? isLoadingSearch : isLoadingCategory;
  const noResults = debouncedQuery.length >= 2 && !isLoadingSearch && searchResults.length === 0;

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
      {noResults && searchQuery.trim().length > 0 && (
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

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing[4],
  },
  label: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    marginBottom: Spacing[2],
    marginLeft: 4,
  },
  searchRow: {
    marginBottom: Spacing[3],
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingHorizontal: Spacing[3],
  },
  searchIcon: {
    marginRight: Spacing[2],
  },
  searchInput: {
    flex: 1,
    paddingVertical: Spacing[2],
    color: Colors.onSurface,
    fontFamily: Fonts.scribe,
    fontSize: 14,
  },
  clearButton: {
    padding: 4,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  tagChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tagChipPending: {
    borderColor: Colors.tertiary,
    borderStyle: 'dashed',
  },
  tagChipText: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.onSurfaceVariant,
  },
  tagChipTextSelected: {
    color: Colors.onPrimary,
    fontWeight: '600',
  },
  suggestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[4],
    marginTop: Spacing[2],
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.tertiary,
    borderStyle: 'dashed',
    backgroundColor: Colors.surfaceContainerLow,
  },
  suggestText: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.tertiary,
    marginLeft: Spacing[2],
    fontStyle: 'italic',
  },
  selectedSummary: {
    marginTop: Spacing[3],
  },
  selectedLabel: {
    fontFamily: Fonts.scribe,
    fontSize: 11,
    color: Colors.outline,
    marginBottom: Spacing[1],
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  selectedChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingLeft: Spacing[3],
    paddingRight: Spacing[2],
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryContainer,
  },
  selectedChipText: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.onPrimaryContainer,
  },
});
