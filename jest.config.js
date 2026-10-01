/** @type {import('jest').Config} */
export default {
  // Use ts-jest to handle TypeScript test files
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          // Allow 'as const' and other TS-only syntax
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
        },
      },
    ],
  },
  // Recognise .ts and .tsx extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Tests live in the tests/ directory
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/src/**/*.test.ts'],
  // ESM support
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  // Node test environment (no jsdom needed for coordinateMath)
  testEnvironment: 'node',
};
