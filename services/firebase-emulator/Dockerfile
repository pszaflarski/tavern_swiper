FROM node:lts-slim

# Install firebase-tools
RUN npm install -g firebase-tools

# Setup working directory
WORKDIR /app

# Create a default firebase.json if none exists
RUN echo '{\n\
  "emulators": {\n\
    "auth": {\n\
      "port": 9099,\n\
      "host": "0.0.0.0"\n\
    },\n\
    "ui": {\n\
      "enabled": false\n\
    }\n\
  }\n\
}' > firebase.json

# Expose the auth emulator port
EXPOSE 9099

# Run the emulator
CMD ["firebase", "emulators:start", "--only", "auth", "--project", "tavern-swiper-dev"]
