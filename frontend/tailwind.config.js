/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: ['./index.html', './src/**/*.{js,jsx}'],
    theme: {
        extend: {
            colors: {
                brand: {
                    50: '#eff6ff',
                    100: '#dbeafe',
                    500: '#1e3a8a',
                    700: '#1e3a8a',
                    900: '#172554',
                },
            },
            boxShadow: {
                panel: '0 6px 20px -8px rgba(15, 23, 42, 0.12)',
            },
        },
    },
    plugins: [],
}
