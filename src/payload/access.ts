import type { Access } from "payload";

export const isAuthenticated: Access = ({ req: { user } }) => {
  return Boolean(user);
};

export const allowPublicRead: Access = ({ req: { user } }) => {
  if (user) {
    return true;
  }

  return {
    _status: {
      equals: "published",
    },
  };
};
