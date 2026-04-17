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
	DeleteUser(ctx context.Context, uid string) error
	DeleteUsers(ctx context.Context, uids []string) (*auth.DeleteUsersResult, error)
}

// Function pointer to allow mocking in tests
var getAuthFunc = func(ctx context.Context) (AuthClient, error) {
	return getAuthInternal(ctx)
}

type realAuthClient struct {
	*auth.Client
}

func getAuthInternal(ctx context.Context) (AuthClient, error) {
	firebaseAppOnce.Do(func() {
		log.Println("Initializing Firebase Admin SDK...")
		firebaseApp, firebaseAppErr = firebase.NewApp(ctx, nil)
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
