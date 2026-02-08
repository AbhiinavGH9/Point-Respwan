import axios from 'axios';
import { Platform } from 'react-native';
import { getToken } from '../utils/storage';

// Use environment variable for production, fallback to localhost/emulator for dev
const BASE_URL = process.env.EXPO_PUBLIC_API_URL
    ? `${process.env.EXPO_PUBLIC_API_URL}/api`
    : (Platform.OS === 'android' ? 'http://10.0.2.2:5000/api' : 'http://localhost:5000/api');

const api = axios.create({
    baseURL: BASE_URL,
});

api.interceptors.request.use(async (config) => {
    const token = await getToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export default api;
export const SERVER_URL = process.env.EXPO_PUBLIC_API_URL
    ? process.env.EXPO_PUBLIC_API_URL
    : (Platform.OS === 'android' ? 'http://10.0.2.2:5000' : 'http://localhost:5000');
