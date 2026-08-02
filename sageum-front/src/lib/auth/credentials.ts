export type Credentials = {
  email: string;
  password: string;
};

export type CredentialsValidation =
  | { success: true; data: Credentials }
  | { success: false; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCredentials(formData: FormData): CredentialsValidation {
  const email = String(formData.get('email') ?? '').trim().toLocaleLowerCase('en-US');
  const password = String(formData.get('password') ?? '');

  if (!EMAIL_PATTERN.test(email)) {
    return { success: false, message: '올바른 이메일 주소를 입력해 주세요.' };
  }

  if (password.length < 6) {
    return { success: false, message: '비밀번호는 6자 이상이어야 합니다.' };
  }

  return { success: true, data: { email, password } };
}
