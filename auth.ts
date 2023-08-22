export const isAuth = (req: any, res: any, next: any) => {
  const auth = req.headers.authorization;
  if (auth === process.env.TOKEN) {
    next();
  } else {
    res.status(401);
    res.send("Access forbidden");
  }
};
