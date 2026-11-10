module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.service.ts', '!src/**/*.spec.ts'],
};
