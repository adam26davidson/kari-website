# API Testing Guide

This directory contains tests for the Kari Website API. Tests are organized by functionality area.

## Running Tests

To run all tests:
```bash
cargo test
```

To run specific tests:
```bash
cargo test auth_tests # Run all auth tests
cargo test test_auth_middleware_with_valid_token # Run a specific test
```

## Test Structure

- `auth_tests.rs` - Tests for authentication and authorization
- `test_utils.rs` - Common test utilities and helpers
- `mod.rs` - Module definitions

## Test Strategy

1. **Auth Testing**: 
   - Tests JWT validation and middleware
   - Simulates valid and invalid tokens
   - Mocks Auth0 JWKS responses

2. **API Endpoint Testing** (Future):
   - Test public and secure endpoints
   - Mock S3 responses
   - Verify data serialization/deserialization
   
3. **S3 Integration Testing** (Future):
   - Mock AWS S3 interactions
   - Verify content upload/download
   - Test error handling

## Mocking Strategy

Most tests use mock implementations rather than actual external services:
- JWT validation uses test keys rather than calling Auth0
- S3 operations use local mock data rather than actual AWS resources
- HTTP requests are intercepted and mocked responses are returned

## Adding New Tests

1. Create a new test file in this directory for your feature area
2. Add it to the `mod.rs` file
3. Use the test utils where possible
4. Follow the existing patterns for consistency