# EchoList Backend Services

## Introduction

EchoList's backend infrastructure is built on a modern, scalable microservices architecture using Node.js/Express.js. This system powers the comprehensive multi-platform marketplace, handling everything from AI-powered listing creation to secure transaction processing.

### Key Features
- RESTful API services built with Express.js and TypeScript
- Microservices architecture for scalability and maintainability
- RabbitMQ message queuing for asynchronous processing
- AI processing services for image recognition and automation
- Secure payment processing with Stripe integration
- Real-time communication using Socket.io

## Prerequisites

- Node.js (v16.x or higher)
- Docker and Docker Compose
- AWS CLI configured with appropriate credentials
- MongoDB (local development)
- Redis (caching and session management)

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/echolist/backend.git
cd backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Start development environment
docker-compose up -d

# Start the development server
npm run dev
```

### Development Environment Setup

The development environment uses Docker to ensure consistency across team members. Key services include:

- Node.js application server
- MongoDB database
- Redis cache
- RabbitMQ message broker
- Mock AWS services (localstack)

## Project Structure

```
src/
├── api/            # API route definitions
├── config/         # Configuration files
├── controllers/    # Request handlers
├── middleware/     # Custom middleware
├── models/         # Database models
├── services/       # Business logic
├── utils/          # Utility functions
└── workers/        # Background job processors
```

## Development

### Coding Standards

- Follow TypeScript best practices
- Use ESLint and Prettier for code formatting
- Write unit tests for all new features
- Document API endpoints using OpenAPI/Swagger
- Follow Git flow branching strategy

### Running Services

```bash
# Development mode with hot reload
npm run dev

# Production mode
npm run start

# Run specific service
npm run service:auth
npm run service:listing
npm run service:transaction
```

## Testing

### Running Tests

```bash
# Run all tests
npm run test

# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e

# Generate coverage report
npm run test:coverage
```

## Deployment

### Environment Configuration

Required environment variables:

```
NODE_ENV=development
PORT=3000
DATABASE_URL=mongodb://localhost:27017/echolist
REDIS_URL=redis://localhost:6379
AWS_REGION=us-east-1
STRIPE_SECRET_KEY=sk_test_...
```

### Deployment Procedures

1. **Development**
   ```bash
   npm run deploy:dev
   ```

2. **Staging**
   ```bash
   npm run deploy:staging
   ```

3. **Production**
   ```bash
   npm run deploy:prod
   ```

## API Documentation

API documentation is available at `/api/docs` when running the server. The documentation is generated using OpenAPI/Swagger specifications.

### Key Endpoints

- Authentication: `/api/v1/auth`
- Listings: `/api/v1/listings`
- Transactions: `/api/v1/transactions`
- Messages: `/api/v1/messages`
- BuyShield: `/api/v1/buyshield`

## Troubleshooting

### Common Issues

1. **Database Connection Issues**
   - Verify MongoDB is running: `docker-compose ps`
   - Check connection string in `.env`
   - Ensure network connectivity

2. **Docker Services**
   - Reset containers: `docker-compose down && docker-compose up -d`
   - Check logs: `docker-compose logs -f [service]`

3. **Environment Variables**
   - Verify all required variables are set
   - Check for proper AWS credentials
   - Validate Stripe API keys

## Security

- All endpoints require authentication unless explicitly public
- API keys and secrets must be stored in AWS Secrets Manager
- Regular security audits are performed
- All data is encrypted at rest and in transit
- Rate limiting is enabled on all endpoints

## Performance

### Optimization Guidelines

- Use Redis caching for frequent queries
- Implement database indexing strategies
- Utilize connection pooling
- Enable compression for API responses

### Monitoring

- AWS CloudWatch for metrics and logging
- ELK Stack for log aggregation
- Custom performance monitoring dashboard
- Real-time alert system for critical issues

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

### Pull Request Guidelines

- Include unit tests
- Update documentation
- Follow code style guidelines
- Add meaningful commit messages

## Contact

- **Team**: EchoList Backend Team
- **Repository**: https://github.com/echolist/backend.git
- **Issues**: https://github.com/echolist/backend/issues

## License

UNLICENSED - All rights reserved

---

*This documentation is maintained by the EchoList Team and is updated regularly to reflect the latest changes in the backend infrastructure.*