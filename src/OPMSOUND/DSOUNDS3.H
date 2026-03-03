int dx3_InitSoundBuffer(void);
void dx3_TermSoundBuffer(void);
void dx3_MakeSoundBuffer(DWORD sample);
void dx3_ProcSoundBuffer(void);
void dx3_ClearSoundBuffer(void);
void dx3_ResetSoundBuffer(void);

void dx3_WaveInit(void);
void dx3_WaveAllTerm(void);
int dx3_WaveCreate(LPSTR filename, int num, int volume);
int dx3_WavePlay(int num, int lpflg);
void dx3_WaveVolume(int num, int volume);
void dx3_WaveStop(int num);
void dx3_WaveRelease(int num);

void dx3_PlayDirectSound(void);
void dx3_StopDirectSound(void);
