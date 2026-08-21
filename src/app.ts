import express from 'express';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export const app = express();

app.use(express.json());
app.use(apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
