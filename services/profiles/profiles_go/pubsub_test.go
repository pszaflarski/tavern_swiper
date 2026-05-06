package main

import (
	"testing"
	"github.com/stretchr/testify/assert"
)

func TestPubSubMapping(t *testing.T) {
	t.Run("toProtoAge", func(t *testing.T) {
		assert.Nil(t, toProtoAge(nil))
		age := 25
		res := toProtoAge(&age)
		assert.NotNil(t, res)
		assert.Equal(t, int32(25), *res)
	})

	t.Run("toProtoTags", func(t *testing.T) {
		assert.Nil(t, toProtoTags(nil))
		tags := []ProfileTag{
			{ID: "t1", Name: "Tag 1", Slug: "cat__tag1", Category: "cat"},
		}
		res := toProtoTags(tags)
		assert.Len(t, res, 1)
		assert.Equal(t, "t1", res[0].Id)
		assert.Equal(t, "Tag 1", res[0].Name)
		assert.Equal(t, "cat__tag1", res[0].Slug)
	})
}
