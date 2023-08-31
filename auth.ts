export const isAuth = (req: any, res: any, next: any) => {
  if (process.env.ENVIROMENT === "development") {
    return next();
  }
  const auth = req.headers.authorization || req.query.token;
  if (auth === process.env.TOKEN) {
    next();
  } else {
    res.status(401);
    res.send("Access forbidden");
  }
};
