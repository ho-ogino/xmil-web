#ifdef USE_DSOUND7

int dx7_InitSoundBuffer(void);
void dx7_TermSoundBuffer(void);
void dx7_MakeSoundBuffer(DWORD sample);
void dx7_ProcSoundBuffer(void);
void dx7_ClearSoundBuffer(void);
void dx7_ResetSoundBuffer(void);

void dx7_WaveInit(void);
void dx7_WaveAllTerm(void);
int dx7_WaveCreate(LPSTR filename, int num, int volume);
int dx7_WavePlay(int num, int lpflg);
void dx7_WaveVolume(int num, int volume);
void dx7_WaveStop(int num);
void dx7_WaveRelease(int num);

void dx7_PlayDirectSound(void);
void dx7_StopDirectSound(void);

#endif
