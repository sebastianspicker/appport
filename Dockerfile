FROM python:3.11-slim
WORKDIR /app
COPY . .
CMD ["python", "-m", "src"]

# forced-relution-1
