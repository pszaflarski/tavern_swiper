package main

import "time"

type ServiceRoute struct {
	Service   string    `json:"service"   firestore:"service"`
	Tag       string    `json:"tag"       firestore:"tag"`
	URL       string    `json:"url"       firestore:"url"`
	CreatedAt time.Time `json:"created_at" firestore:"created_at"`
	UpdatedAt time.Time `json:"updated_at" firestore:"updated_at"`
}

type SingleServiceResponse struct {
	Service string `json:"service"`
	Tag     string `json:"tag"`
	URL     string `json:"url"`
}

type ServiceUpdate struct {
	Tag string `json:"tag" binding:"required"`
	URL string `json:"url" binding:"required"`
}
