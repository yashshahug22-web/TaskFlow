import axios from 'axios'; 

const baseURL = import.meta.env.VITE_BASEURL || 'http://localhost:5000';

const api = axios.create({
    baseURL,
}); 

export default api;