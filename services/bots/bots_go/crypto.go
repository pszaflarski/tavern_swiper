package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"

	kms "cloud.google.com/go/kms/apiv1"
	"cloud.google.com/go/kms/apiv1/kmspb"
)

func generateRandomPassword() string {
	b := make([]byte, 16)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func encryptPassword(ctx context.Context, plaintext string) (string, error) {
	keyName := os.Getenv("KMS_KEY_NAME")
	if keyName == "" {
		// Fallback for local testing if no KMS
		if os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" {
			return base64.StdEncoding.EncodeToString([]byte(plaintext)), nil
		}
		return "", fmt.Errorf("KMS_KEY_NAME not set")
	}

	client, err := kms.NewKeyManagementClient(ctx)
	if err != nil {
		return "", err
	}
	defer client.Close()

	req := &kmspb.EncryptRequest{
		Name:      keyName,
		Plaintext: []byte(plaintext),
	}

	resp, err := client.Encrypt(ctx, req)
	if err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(resp.Ciphertext), nil
}

// decryptPasswordFunc is a replaceable function for test mocking.
var decryptPasswordFunc = decryptPassword

func decryptPassword(ctx context.Context, encryptedBase64 string) (string, error) {
	keyName := os.Getenv("KMS_KEY_NAME")
	if keyName == "" {
		// Fallback for local testing
		if os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" {
			b, err := base64.StdEncoding.DecodeString(encryptedBase64)
			return string(b), err
		}
		return "", fmt.Errorf("KMS_KEY_NAME not set")
	}

	ciphertext, err := base64.StdEncoding.DecodeString(encryptedBase64)
	if err != nil {
		return "", err
	}

	client, err := kms.NewKeyManagementClient(ctx)
	if err != nil {
		return "", err
	}
	defer client.Close()

	req := &kmspb.DecryptRequest{
		Name:       keyName,
		Ciphertext: ciphertext,
	}

	resp, err := client.Decrypt(ctx, req)
	if err != nil {
		return "", err
	}

	return string(resp.Plaintext), nil
}
