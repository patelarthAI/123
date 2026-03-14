const test = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/resumes/pending', {
      headers: { 'x-admin-password': 'admin123' }
    });
    console.log(res.status);
    console.log(await res.text());
  } catch (e) {
    console.error(e);
  }
};
test();
