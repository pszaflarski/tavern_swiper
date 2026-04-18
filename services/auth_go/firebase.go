package main

import (
	"context"
	"log"
	"sync"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
)

var (
	firebaseApp     *firebase.App
	firebaseAppOnce sync.Once
	firebaseAppErr  error
)

// AuthClient defines the subset of firebase auth methods used by this service
type AuthClient interface {
	VerifyIDToken(ctx context.Context, idToken string) (*auth.Token, error)
	DeleteUser(ctx context.Context, uid string) error
	DeleteUsers(ctx context.Context, uids []string) (*auth.DeleteUsersResult, error)
	ListUsers(ctx context.Context) ([]string, error)
}

// Function pointer to allow mocking in tests
var getAuthFunc = func(ctx context.Context) (AuthClient, error) {
	return getAuthInternal(ctx)
}

type realAuthClient struct {
	*auth.Client
}

func (c *realAuthClient) ListUsers(ctx context.Context) ([]string, error) {
	var uids []string
	iter := c.Client.Users(ctx, "")
	for {
		user, err := iter.Next()
		if err != nil {
			if err.Error() == "no more items in iterator" {
				break
			}
			return nil, err
		}
		uids = append(uids, user.UID)
	}
	return uids, nil
}

func getAuthInternal(ctx context.Context) (AuthClient, error) {
	firebaseAppOnce.Do(func() {
		log.Println("Initializing Firebase Admin SDK...")
		// Use Background context for initialization to avoid capturing a short-lived request context
		firebaseApp, firebaseAppErr = firebase.NewApp(context.Background(), nil)
	})
	if firebaseAppErr != nil {
		return nil, firebaseAppErr
	}
	client, err := firebaseApp.Auth(ctx)
	if err != nil {
		return nil, err
	}
	return &realAuthClient{client}, nil
}
