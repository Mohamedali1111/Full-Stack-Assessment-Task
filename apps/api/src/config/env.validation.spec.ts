import { validateEnvironment } from './env.validation';

const requiredConfig = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/projectflow-test',
  JWT_SECRET: 'test-secret',
};

describe('validateEnvironment', () => {
  it('uses PORT before API_PORT when both are provided', () => {
    const environment = validateEnvironment({
      ...requiredConfig,
      PORT: '10000',
      API_PORT: '4732',
    });

    expect(environment.API_PORT).toBe(10000);
  });

  it('uses API_PORT when PORT is absent', () => {
    const environment = validateEnvironment({
      ...requiredConfig,
      API_PORT: '4732',
    });

    expect(environment.API_PORT).toBe(4732);
  });

  it('uses API_PORT when PORT is blank', () => {
    const environment = validateEnvironment({
      ...requiredConfig,
      PORT: '   ',
      API_PORT: '4732',
    });

    expect(environment.API_PORT).toBe(4732);
  });

  it('uses the default port when PORT and API_PORT are absent', () => {
    const environment = validateEnvironment(requiredConfig);

    expect(environment.API_PORT).toBe(4732);
  });

  it('rejects a non-empty non-numeric PORT', () => {
    expect(() =>
      validateEnvironment({
        ...requiredConfig,
        PORT: '3000abc',
        API_PORT: '4732',
      }),
    ).toThrow('PORT/API_PORT must be a positive integer');
  });
});
