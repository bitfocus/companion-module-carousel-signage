import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{
		ignores: ['.pnp.*', 'build-config.cjs', 'coverage/**', 'dist/**', 'node_modules/**', 'pkg/**'],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['scripts/*.mjs'],
		languageOptions: {
			globals: {
				process: 'readonly',
				console: 'readonly',
				Buffer: 'readonly',
				URL: 'readonly',
				URLSearchParams: 'readonly',
				structuredClone: 'readonly',
				setTimeout: 'readonly',
			},
		},
	},
	{
		files: ['**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
		},
	},
)
