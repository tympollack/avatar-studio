import React from 'react';

export const Stage: React.FC<any> = ({ children }) => React.createElement('div', { 'data-testid': 'stage' }, children);
export const Layer: React.FC<any> = ({ children }) => React.createElement('div', { 'data-testid': 'layer' }, children);
export const Group: React.FC<any> = ({ children }) => React.createElement('div', { 'data-testid': 'group' }, children);
export const Rect: React.FC<any> = (props) => React.createElement('div', { 'data-testid': 'rect', ...props });
export const Circle: React.FC<any> = (props) => React.createElement('div', { 'data-testid': 'circle', ...props });
export const Image: React.FC<any> = (props) => React.createElement('div', { 'data-testid': 'image', ...props });
export const Text: React.FC<any> = (props) => React.createElement('div', { 'data-testid': 'text', ...props });

export default {
  Stage,
  Layer,
  Group,
  Rect,
  Circle,
  Image,
  Text,
};
