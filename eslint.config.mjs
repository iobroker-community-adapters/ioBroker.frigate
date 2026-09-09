import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        languageOptions: {
            parserOptions: {
                // tasks.ts is a build helper and therefore outside of the "src" scope of
                // tsconfig.json, so the project service has to fall back to its default project
                projectService: {
                    allowDefaultProject: ['*.js', '*.mjs', 'tasks.ts'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        // disable temporary the rule 'jsdoc/require-param' and enable 'jsdoc/require-jsdoc'
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/check-param-names': 'off',
        },
    },
    {
        ignores: ['build/**/*', 'admin/**/*', 'test/**/*', '**/*.mjs', 'src-devices/**/*'],
    },
];
